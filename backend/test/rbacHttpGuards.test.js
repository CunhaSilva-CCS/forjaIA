const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'rbac-http-guards-test-token-24c';
process.env.FORJA_ALLOW_MOCKS = 'true';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-rbac-http-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-rbac-http-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3096';
process.env.CORS_ORIGIN = 'http://127.0.0.1:3096';

const BASE = `http://${process.env.HOST}:${process.env.PORT}`;
const ADMIN_TOKEN = process.env.FORJA_API_TOKEN;
const VIEWER_TOKEN = 'viewer-guard-test-token-xyz';
const MEMBER_TOKEN = 'member-guard-test-token-xyz';

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

/**
 * Achado real (pente fino → ADR-025): /api/agent/run, /api/agent/validate, /api/agent/cancel e
 * /api/agent/user-report não checavam papel nenhum — qualquer membro autenticado (mesmo um
 * hipotético papel só-leitura) podia disparar/cancelar run de qualquer um. Este teste confirma
 * contra o servidor HTTP real (não só a função pura de rbac.js) que um membro 'viewer' de verdade
 * toma 403 nessas 4 rotas, e que um papel normal ('member') continua passando pela checagem de
 * papel (podendo falhar depois por outro motivo, mas não por 403 de RBAC).
 */
describe('RBAC nas rotas de agente — papel viewer barrado, member passa (achado real)', () => {
  before(async () => {
    handle = require('../server');
    await waitForHealth();
    const { team } = require('../lib/team');
    team.create({ name: 'Viewer de teste', role: 'viewer', token: VIEWER_TOKEN });
    team.create({ name: 'Member de teste', role: 'member', token: MEMBER_TOKEN });
  });

  after(async () => {
    await new Promise((resolve) => handle.server.close(() => resolve()));
  });

  it('viewer toma 403 em POST /api/agent/run', async () => {
    const res = await fetch(`${BASE}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VIEWER_TOKEN}` },
      body: JSON.stringify({ prompt: 'faça algo', config: {} })
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /viewer/);
  });

  it('viewer toma 403 em POST /api/agent/validate', async () => {
    const res = await fetch(`${BASE}/api/agent/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VIEWER_TOKEN}` },
      body: JSON.stringify({ sourcePath: 'algum-projeto', config: {} })
    });
    assert.equal(res.status, 403);
  });

  it('viewer toma 403 em POST /api/agent/cancel', async () => {
    const res = await fetch(`${BASE}/api/agent/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VIEWER_TOKEN}` }
    });
    assert.equal(res.status, 403);
  });

  it('viewer toma 403 em POST /api/agent/user-report', async () => {
    const res = await fetch(`${BASE}/api/agent/user-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VIEWER_TOKEN}` },
      body: JSON.stringify({ message: 'achei um bug' })
    });
    assert.equal(res.status, 403);
  });

  it('member NÃO toma 403 de RBAC em /api/agent/cancel (passa a checagem de papel)', async () => {
    const res = await fetch(`${BASE}/api/agent/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MEMBER_TOKEN}` }
    });
    // Sem run ativa pra cancelar, mas o ponto é que NÃO é 403 — a checagem de papel deixou passar.
    assert.notEqual(res.status, 403);
  });

  it('admin nunca toma 403 de RBAC nessas rotas', async () => {
    const res = await fetch(`${BASE}/api/agent/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    assert.notEqual(res.status, 403);
  });
});
