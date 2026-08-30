const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'qa-plan-scenarios-token-24chars';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-qa-plan-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-qa-plan-${Date.now()}.db`);

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

const files = [{ name: 'index.js', path: 'src/index.js', content: '// app' }];

describe('qa.execute — cenários aprovados no plano (determinístico, P0)', () => {
  it('usa testScenarios do savedPlan e não chama o LLM de geração dinâmica', async () => {
    const { server, baseUrl } = await startServer((req, res, body) => {
      if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { ok: true });
      if (req.method === 'POST' && req.url === '/api/items') return sendJson(res, 201, { id: 'i1', ...body });
      sendJson(res, 404, {});
    });

    const originalStart = sandboxRunner.start;
    const originalStop = sandboxRunner.stop;
    sandboxRunner.start = async () => ({ baseUrl });
    sandboxRunner.stop = async () => {};

    let llmCalls = 0;
    const originalLlm = llm.generateJson;
    llm.generateJson = async () => {
      llmCalls += 1;
      return { data: { cases: [] }, provider: 'x', model: 'y', tokens: null };
    };

    const logs = [];
    const orchestrator = {
      log: (_agent, msg) => logs.push(msg),
      getSignal: () => undefined,
      recordTokens: () => {},
      savedPlan: {
        testScenarios: [
          { name: 'Health', method: 'GET', path: '/health', expectedStatus: '200', expect: 'none' },
          {
            name: 'Criar item',
            method: 'POST',
            path: '/api/items',
            body: { title: 'x' },
            expectedStatus: '201',
            expect: 'object-id'
          }
        ]
      }
    };

    try {
      const report = await qa.execute(files, {}, orchestrator);
      assert.equal(report.passed, true, JSON.stringify(report.tests, null, 2));
      assert.equal(llmCalls, 1, 'só a revisão sênior de QA deve chamar LLM, não a geração dinâmica');
      assert.ok(logs.some((m) => m.includes('cenários aprovados no plano arquitetural')));
      assert.ok(!logs.some((m) => m.includes('gerada dinamicamente')));
    } finally {
      sandboxRunner.start = originalStart;
      sandboxRunner.stop = originalStop;
      llm.generateJson = originalLlm;
      await closeServer(server);
    }
  });
});
