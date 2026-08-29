const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'qa-crud-test-token-24chars-x';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-qa-crud-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-qa-crud-${Date.now()}.db`);

const { __test__ } = require('../agent/qa');
const { runCrudTests, runRagTests } = __test__;

const orchestrator = { log: () => {} };

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

describe('qa.runCrudTests — achado real (ADR-034): não trava mais numa única convenção de campo', () => {
  it('achado real: um app com respostas JSON simples (SEM envelope success/tasks/task) passa em todos os testes', async () => {
    // Mesma forma exata das respostas observadas ao vivo contra o app gerado pelo Ollama nesta
    // sessão: array na raiz, objeto criado na raiz, sem chave "success" em lugar nenhum.
    let taskId = null;
    const { server, baseUrl } = await startServer((req, res, body) => {
      if (req.method === 'GET' && req.url === '/api/tasks') return sendJson(res, 200, []);
      if (req.method === 'POST' && req.url === '/api/tasks') {
        if (!body?.title) return sendJson(res, 400, { error: 'Title is required' });
        taskId = 'task-1';
        return sendJson(res, 201, { id: taskId, title: body.title, completed: false });
      }
      if (req.method === 'PUT' && req.url === `/api/tasks/${taskId}`) {
        return sendJson(res, 200, { id: taskId, title: body.title, completed: body.completed });
      }
      if (req.method === 'DELETE' && req.url === `/api/tasks/${taskId}`) {
        res.writeHead(204);
        return res.end();
      }
      sendJson(res, 404, { error: 'not found' });
    });
    try {
      const result = await runCrudTests(baseUrl, orchestrator);
      assert.equal(result.passed, true, JSON.stringify(result.tests, null, 2));
      assert.ok(result.tests.every((t) => t.passed));
    } finally {
      await closeServer(server);
    }
  });

  it('sem regressão: o formato exato dos MOCK_CODES ({success:true, tasks/task}) continua passando', async () => {
    let taskId = null;
    const { server, baseUrl } = await startServer((req, res, body) => {
      if (req.method === 'GET' && req.url === '/api/tasks') return sendJson(res, 200, { success: true, tasks: [] });
      if (req.method === 'POST' && req.url === '/api/tasks') {
        if (!body?.title) return sendJson(res, 400, { success: false, error: 'Título é obrigatório!' });
        taskId = 'task-mock-1';
        return sendJson(res, 201, { success: true, task: { id: taskId, title: body.title, completed: false } });
      }
      if (req.method === 'PUT' && req.url === `/api/tasks/${taskId}`) {
        return sendJson(res, 200, { success: true, task: { id: taskId, completed: body.completed } });
      }
      if (req.method === 'DELETE' && req.url === `/api/tasks/${taskId}`) {
        return sendJson(res, 200, { success: true });
      }
      sendJson(res, 404, { success: false });
    });
    try {
      const result = await runCrudTests(baseUrl, orchestrator);
      assert.equal(result.passed, true, JSON.stringify(result.tests, null, 2));
    } finally {
      await closeServer(server);
    }
  });

  it('achado real: envelope {data: [...]} (outra convenção comum) também passa', async () => {
    let taskId = null;
    const { server, baseUrl } = await startServer((req, res, body) => {
      if (req.method === 'GET' && req.url === '/api/tasks') return sendJson(res, 200, { data: [{ id: 'x' }] });
      if (req.method === 'POST' && req.url === '/api/tasks') {
        if (!body?.title) return sendJson(res, 422, { data: null, error: 'title obrigatório' });
        taskId = 'task-2';
        return sendJson(res, 201, { data: { id: taskId, completed: false } });
      }
      if (req.method === 'PUT' && req.url === `/api/tasks/${taskId}`) {
        return sendJson(res, 200, { data: { id: taskId, completed: true } });
      }
      if (req.method === 'DELETE' && req.url === `/api/tasks/${taskId}`) {
        return sendJson(res, 200, { data: null });
      }
      sendJson(res, 404, {});
    });
    try {
      const result = await runCrudTests(baseUrl, orchestrator);
      assert.equal(result.passed, true, JSON.stringify(result.tests, null, 2));
    } finally {
      await closeServer(server);
    }
  });

  it('achado real: uma lista que nunca vem (nem array na raiz nem em nenhuma chave conhecida) ainda reprova de verdade — a tolerância não virou "sempre passa"', async () => {
    const { server, baseUrl } = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/tasks') return sendJson(res, 200, { message: 'ok, mas sem lista' });
      sendJson(res, 404, {});
    });
    try {
      const result = await runCrudTests(baseUrl, orchestrator);
      assert.equal(result.tests[0].passed, false);
      assert.match(result.tests[0].error, /Erro ao recuperar tarefas/);
    } finally {
      await closeServer(server);
    }
  });

  it('achado real: status 500 num endpoint continua reprovando, mesmo com corpo JSON bem-formado', async () => {
    const { server, baseUrl } = await startServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/tasks') return sendJson(res, 500, { tasks: [] });
      sendJson(res, 404, {});
    });
    try {
      const result = await runCrudTests(baseUrl, orchestrator);
      assert.equal(result.tests[0].passed, false);
    } finally {
      await closeServer(server);
    }
  });
});

describe('qa.runRagTests — mesma tolerância aplicada (ADR-034)', () => {
  it('aceita array de matches na raiz OU em results/data, não só em "matches"', async () => {
    const { server, baseUrl } = await startServer((req, res) => {
      if (req.url === '/api/health') return sendJson(res, 200, { status: 'ok' });
      if (req.url === '/api/ingest/text') return sendJson(res, 201, { id: 'doc-1' });
      if (req.url === '/api/query') return sendJson(res, 200, { results: [{ text: 'trecho relevante' }] });
      sendJson(res, 404, {});
    });
    try {
      const result = await runRagTests(baseUrl, orchestrator);
      assert.equal(result.tests[0].passed, true);
      assert.equal(result.tests[1].passed, true);
      assert.equal(result.tests[2].passed, true, JSON.stringify(result.tests[2]));
    } finally {
      await closeServer(server);
    }
  });
});
