const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'qa-dynamic-suite-token-24-chars';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-qa-dynamic-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-qa-dynamic-${Date.now()}.db`);

const llm = require('../lib/llm');
const sandboxRunner = require('../sandbox/runner');
const qa = require('../agent/qa');

function startServer(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      } catch {
        body = null;
      }
      handler(req, res, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}
function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(value === undefined ? '' : JSON.stringify(value));
}

const files = [{ name: 'index.js', path: 'src/index.js', content: '// api simples' }];

function stubSandbox(baseUrl) {
  const originalStart = sandboxRunner.start;
  const originalStop = sandboxRunner.stop;
  sandboxRunner.start = async () => ({ baseUrl });
  sandboxRunner.stop = async () => {};
  return () => {
    sandboxRunner.start = originalStart;
    sandboxRunner.stop = originalStop;
  };
}

function stubLlm(impl) {
  const original = llm.generateJson;
  llm.generateJson = impl;
  return () => {
    llm.generateJson = original;
  };
}

describe('qa.execute — geração dinâmica de suíte a partir do código real (ADR-036)', () => {
  it('usa o plano dinâmico quando o LLM devolve casos válidos, e não toca nas suítes fixas', async () => {
    const { server, baseUrl } = await startServer((req, res, body) => {
      if (req.method === 'GET' && req.url === '/api/ping') return sendJson(res, 200, { items: [1, 2] });
      if (req.method === 'POST' && req.url === '/api/ping') return sendJson(res, 201, { id: 'p1', ...body });
      sendJson(res, 404, {});
    });
    const restoreSandbox = stubSandbox(baseUrl);
    const restoreLlm = stubLlm(async () => ({
      data: {
        cases: [
          { name: 'Ping - listar', method: 'GET', path: '/api/ping', expectedStatus: '200', expect: 'list' },
          {
            name: 'Ping - criar',
            method: 'POST',
            path: '/api/ping',
            body: { msg: 'oi' },
            expectedStatus: '201',
            expect: 'object-id'
          }
        ]
      },
      provider: 'fake-provider',
      model: 'fake-model',
      tokens: null
    }));

    const logs = [];
    const orchestrator = { log: (_agent, msg) => logs.push(msg), getSignal: () => undefined, recordTokens: () => {} };

    try {
      const report = await qa.execute(files, {}, orchestrator);
      assert.equal(report.passed, true, JSON.stringify(report.tests, null, 2));
      assert.deepEqual(
        report.tests.map((t) => t.name),
        ['Ping - listar', 'Ping - criar']
      );
      assert.ok(logs.some((m) => m.includes('gerada dinamicamente')), 'esperava log confirmando o caminho dinâmico');
      assert.ok(!logs.some((m) => m.includes('suíte fixa de fallback')), 'não deveria ter caído no fallback');
    } finally {
      restoreSandbox();
      restoreLlm();
      await closeServer(server);
    }
  });

  it('cai pra suíte fixa (CRUD) quando a geração do plano dinâmico falha (LLM indisponível)', async () => {
    const { server, baseUrl } = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/tasks') return sendJson(res, 200, []);
      sendJson(res, 404, {});
    });
    const restoreSandbox = stubSandbox(baseUrl);
    const restoreLlm = stubLlm(async () => {
      throw new Error('nenhum provedor de LLM configurado');
    });

    const logs = [];
    const orchestrator = { log: (_agent, msg) => logs.push(msg), getSignal: () => undefined, recordTokens: () => {} };

    try {
      const report = await qa.execute(files, {}, orchestrator);
      assert.ok(logs.some((m) => m.includes('Geração de plano de teste dinâmico falhou')));
      assert.ok(logs.some((m) => m.includes('suíte fixa de fallback')));
      assert.ok(report.tests.some((t) => t.name.includes('Listar Tarefas')), 'esperava a suíte CRUD fixa ter rodado');
    } finally {
      restoreSandbox();
      restoreLlm();
      await closeServer(server);
    }
  });

  it('cai pra suíte fixa quando o LLM devolve um plano vazio/insuficiente (menos de 2 casos válidos)', async () => {
    const { server, baseUrl } = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/tasks') return sendJson(res, 200, []);
      sendJson(res, 404, {});
    });
    const restoreSandbox = stubSandbox(baseUrl);
    const restoreLlm = stubLlm(async () => ({ data: { cases: [] }, provider: 'x', model: 'y', tokens: null }));

    const logs = [];
    const orchestrator = { log: (_agent, msg) => logs.push(msg), getSignal: () => undefined, recordTokens: () => {} };

    try {
      const report = await qa.execute(files, {}, orchestrator);
      assert.ok(logs.some((m) => m.includes('Plano dinâmico vazio/insuficiente')));
      assert.ok(report.tests.some((t) => t.name.includes('Listar Tarefas')));
    } finally {
      restoreSandbox();
      restoreLlm();
      await closeServer(server);
    }
  });

  it('achado real: casos inválidos misturados no plano (path malformado) não contam pro mínimo de 2 e derrubam pro fallback', async () => {
    const { server, baseUrl } = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/tasks') return sendJson(res, 200, []);
      sendJson(res, 404, {});
    });
    const restoreSandbox = stubSandbox(baseUrl);
    const restoreLlm = stubLlm(async () => ({
      data: { cases: [{ name: 'só um válido', method: 'GET', path: '/api/x' }, { name: 'inválido', method: 'GET', path: 'sem-barra' }] },
      provider: 'x',
      model: 'y',
      tokens: null
    }));

    const logs = [];
    const orchestrator = { log: (_agent, msg) => logs.push(msg), getSignal: () => undefined, recordTokens: () => {} };

    try {
      await qa.execute(files, {}, orchestrator);
      assert.ok(logs.some((m) => m.includes('Plano dinâmico vazio/insuficiente')));
    } finally {
      restoreSandbox();
      restoreLlm();
      await closeServer(server);
    }
  });
});
