const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'http-integration-token-24-chars';
process.env.FORJA_ALLOW_MOCKS = 'true';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-http-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-http-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3094';
process.env.CORS_ORIGIN = 'http://127.0.0.1:3094';

const BASE = `http://${process.env.HOST}:${process.env.PORT}`;
const TOKEN = process.env.FORJA_API_TOKEN;

let handle;

async function waitForHealth(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('servidor não ficou saudável a tempo');
}

describe('HTTP integration (server.js real, via fetch)', () => {
  before(async () => {
    handle = require('../server');
    await waitForHealth();
  });

  after(async () => {
    await new Promise((resolve) => handle.server.close(() => resolve()));
  });

  it('GET /api/health é público e responde 200', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.authRequired, true);
  });

  it('GET /api/llm/status é público e responde 200', async () => {
    const res = await fetch(`${BASE}/api/llm/status`);
    assert.equal(res.status, 200);
  });

  it('rota protegida sem token retorna 401', async () => {
    const res = await fetch(`${BASE}/api/runs`);
    assert.equal(res.status, 401);
  });

  it('rota protegida com token inválido retorna 401', async () => {
    const res = await fetch(`${BASE}/api/runs`, {
      headers: { Authorization: 'Bearer token-totalmente-errado' }
    });
    assert.equal(res.status, 401);
  });

  it('rota protegida com token válido retorna 200', async () => {
    const res = await fetch(`${BASE}/api/runs`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()));
  });

  it('GET /api/ops/health (ADR-033) exige token e devolve os sinais agregados de verdade', async () => {
    const unauth = await fetch(`${BASE}/api/ops/health`);
    assert.equal(unauth.status, 401);

    const res = await fetch(`${BASE}/api/ops/health`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.ok, 'boolean');
    assert.equal(typeof body.recentFailureStreak, 'number');
    assert.ok(Array.isArray(body.activeCooldowns));
    assert.ok(Array.isArray(body.alerts));
  });

  it('GET /api/llm/usage (ADR-017) exige token e devolve periods + cooldowns', async () => {
    const unauth = await fetch(`${BASE}/api/llm/usage`);
    assert.equal(unauth.status, 401);

    const res = await fetch(`${BASE}/api/llm/usage`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.periods.gemini, 'esperava entrada de período pro gemini');
    assert.ok('today' in body.periods.gemini && 'week' in body.periods.gemini && 'month' in body.periods.gemini);
    assert.ok(Array.isArray(body.cooldowns));
  });

  it('POST /api/llm/cooldown/:provider/clear (ADR-017) limpa um cooldown ativo', async () => {
    const { providerCooldown } = require('../lib/llmUsage');
    providerCooldown.set('claude', { reason: 'teste', ms: 60000 });
    assert.ok(providerCooldown.get('claude'));

    const res = await fetch(`${BASE}/api/llm/cooldown/claude/clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(res.status, 200);
    assert.equal(providerCooldown.get('claude'), null);
  });

  it('cabeçalhos de segurança do helmet estão presentes', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  });

  it('cabeçalhos de rate limit estão presentes', async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert.ok(res.headers.get('ratelimit-limit'));
  });

  it('POST /api/projects rejeita corpo inválido com 400', async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(res.status, 400);
  });

  it('POST /api/projects cria um projeto válido (201)', async () => {
    const res = await fetch(`${BASE}/api/projects`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'demo', path: 'demo-app' })
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.name, 'demo');
    assert.equal(body.path, 'demo-app');
  });

  it('GET /api/runs/:id inexistente retorna 404', async () => {
    const res = await fetch(`${BASE}/api/runs/nao-existe`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(res.status, 404);
  });

  it('GET /api/team: admin vê bootstrapTokens, membro comum não vê', async () => {
    const adminRes = await fetch(`${BASE}/api/team`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(adminRes.status, 200);
    const adminBody = await adminRes.json();
    assert.ok(adminBody.bootstrapTokens, 'admin deveria ver os tokens de bootstrap');
    const leadToken = adminBody.bootstrapTokens.lead;

    const leadRes = await fetch(`${BASE}/api/team`, { headers: { Authorization: `Bearer ${leadToken}` } });
    assert.equal(leadRes.status, 200);
    const leadBody = await leadRes.json();
    assert.equal(leadBody.bootstrapTokens, null, 'membro não-admin não deveria ver os tokens de bootstrap');
  });

  it('POST /api/team/members exige admin', async () => {
    const adminRes = await fetch(`${BASE}/api/team`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const { bootstrapTokens } = await adminRes.json();

    const asLead = await fetch(`${BASE}/api/team/members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bootstrapTokens.lead}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Novo', role: 'qa', token: 'token-novo-membro-24-chars' })
    });
    assert.equal(asLead.status, 403);

    const asAdmin = await fetch(`${BASE}/api/team/members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Novo', role: 'qa', token: 'token-novo-membro-24-chars' })
    });
    assert.equal(asAdmin.status, 201);
  });

  it('POST /api/team/members/:id/deactivate exige admin e desativa de verdade (achado real: rota nunca existiu)', async () => {
    const created = await fetch(`${BASE}/api/team/members`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Descartável', role: 'qa', token: 'token-descartavel-24-chars' })
    });
    const member = await created.json();

    const adminRes = await fetch(`${BASE}/api/team`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const { bootstrapTokens } = await adminRes.json();

    const asLead = await fetch(`${BASE}/api/team/members/${member.id}/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bootstrapTokens.lead}` }
    });
    assert.equal(asLead.status, 403);

    const asAdmin = await fetch(`${BASE}/api/team/members/${member.id}/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(asAdmin.status, 200);

    const afterRes = await fetch(`${BASE}/api/team`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const after = await afterRes.json();
    assert.ok(!after.members.some((m) => m.id === member.id), 'membro desativado não deveria mais aparecer na listagem');
  });

  it('POST /api/team/members/:id/deactivate com id inexistente responde 404', async () => {
    const res = await fetch(`${BASE}/api/team/members/id-que-nao-existe/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(res.status, 404);
  });

  it('POST /api/team/members/admin/deactivate responde 404 (não dá pra desativar o admin)', async () => {
    const res = await fetch(`${BASE}/api/team/members/admin/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    assert.equal(res.status, 404);
  });
});
