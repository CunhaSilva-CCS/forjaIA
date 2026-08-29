const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');
const { EventEmitter } = require('events');

process.env.FORJA_API_TOKEN = 'independent-audit-http-token-24c';
process.env.FORJA_ALLOW_MOCKS = 'true';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-audit-http-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-audit-http-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3095';
process.env.CORS_ORIGIN = 'http://127.0.0.1:3095';

// Mocka ANTES de requerer o server — dockerBuild.js (usado por lib/independentAudit.js) destructura
// `spawn` de child_process no próprio topo; como este é um processo de teste fresco (node --test
// isola por arquivo), nada ainda tinha carregado dockerBuild.js, então o mock chega a tempo.
childProcess.spawn = (cmd, args) => {
  const full = [cmd, ...(Array.isArray(args) ? args : [])].join(' ');
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (full.startsWith('semgrep --version')) {
      child.emit('close', 127); // simula semgrep não instalado — determinístico, sem depender do host
      return;
    }
    if (full.startsWith('npm audit --json')) {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ vulnerabilities: {} })));
      child.emit('close', 0);
      return;
    }
    child.emit('close', 0);
  });
  return child;
};

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

async function waitForCompleted(id, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE}/api/audit/runs/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const body = await res.json();
    if (body.status !== 'running') return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('auditoria não terminou a tempo');
}

describe('POST /api/audit/run (achado real: rota nova do ADR-021)', () => {
  before(async () => {
    handle = require('../server');
    await waitForHealth();
  });

  after(async () => {
    await new Promise((resolve) => handle.server.close(() => resolve()));
  });

  it('exige autenticação', async () => {
    const res = await fetch(`${BASE}/api/audit/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'self' })
    });
    assert.equal(res.status, 401);
  });

  it('target self: cria a run e ela termina completed com achados vindos do npm audit mockado', async () => {
    const res = await fetch(`${BASE}/api/audit/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ target: 'self' })
    });
    assert.equal(res.status, 200);
    const created = await res.json();
    assert.equal(created.status, 'running');
    assert.ok(created.id);

    const finished = await waitForCompleted(created.id);
    assert.equal(finished.status, 'completed');
    assert.equal(finished.tools.semgrep.available, false);
  });

  it('target project: rejeita path fora do workspace (mesmo guard de resolveWithinWorkspace)', async () => {
    const res = await fetch(`${BASE}/api/audit/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ target: 'project', projectPath: '/etc' })
    });
    assert.notEqual(res.status, 200);
  });

  it('GET /api/audit/runs lista as runs criadas', async () => {
    const res = await fetch(`${BASE}/api/audit/runs`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.runs));
    assert.ok(body.runs.length >= 1);
  });

  it('GET /api/audit/runs/:id inexistente retorna 404', async () => {
    const res = await fetch(`${BASE}/api/audit/runs/nao-existe`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 404);
  });
});
