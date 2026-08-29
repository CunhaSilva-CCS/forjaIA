const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { runGeneratedTests, isValidCase, __test__ } = require('../lib/testPlanRunner');
const { matchesStatus, pickList, pickObjectWithId, pickToken, findField, substitute } = __test__;

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

describe('testPlanRunner helpers (unidade)', () => {
  it('matchesStatus: classe 2xx/4xx, código exato, e lista separada por vírgula', () => {
    assert.equal(matchesStatus(201, '2xx'), true);
    assert.equal(matchesStatus(500, '2xx'), false);
    assert.equal(matchesStatus(404, '404'), true);
    assert.equal(matchesStatus(200, '200,201'), true);
    assert.equal(matchesStatus(204, '200,201'), false);
    assert.equal(matchesStatus(200, undefined), true);
  });

  it('pickList: aceita array na raiz ou em envelope comum', () => {
    assert.deepEqual(pickList([1, 2]), [1, 2]);
    assert.deepEqual(pickList({ data: [1] }), [1]);
    assert.equal(pickList({ message: 'ok' }), null);
  });

  it('pickObjectWithId: aceita objeto com id na raiz ou aninhado', () => {
    assert.deepEqual(pickObjectWithId({ id: 'x' }), { id: 'x' });
    assert.deepEqual(pickObjectWithId({ task: { id: 'y' } }), { id: 'y' });
    assert.equal(pickObjectWithId({ ok: true }), null);
  });

  it('pickToken e findField', () => {
    assert.equal(pickToken({ accessToken: 'abc' }), 'abc');
    assert.equal(findField({ completed: true }, 'completed'), true);
    assert.equal(findField({ task: { completed: true } }, 'completed'), true);
  });

  it('substitute: troca {var} por valor capturado, mantém literal se ausente', () => {
    assert.equal(substitute('/api/tasks/{id}', { id: '42' }), '/api/tasks/42');
    assert.equal(substitute('/api/tasks/{id}', {}), '/api/tasks/{id}');
  });

  it('isValidCase: exige path começando com / e método reconhecido', () => {
    assert.equal(isValidCase({ path: '/api/x', method: 'GET' }), true);
    assert.equal(isValidCase({ path: 'api/x', method: 'GET' }), false);
    assert.equal(isValidCase({ path: '/api/x', method: 'TRACE' }), false);
    assert.equal(isValidCase(null), false);
  });
});

describe('runGeneratedTests — execução real contra servidor HTTP', () => {
  it('achado real (molde ADR-034): plano gerado por LLM sem envelope específico passa mesmo assim', async () => {
    let createdId = null;
    const { server, baseUrl } = await startServer((req, res, body) => {
      if (req.method === 'GET' && req.url === '/api/tasks') return sendJson(res, 200, []);
      if (req.method === 'POST' && req.url === '/api/tasks') {
        if (!body?.title) return sendJson(res, 400, { error: 'title obrigatório' });
        createdId = 'abc123';
        return sendJson(res, 201, { id: createdId, title: body.title, completed: false });
      }
      if (req.method === 'PUT' && req.url === `/api/tasks/${createdId}`) {
        return sendJson(res, 200, { id: createdId, completed: true });
      }
      if (req.method === 'DELETE' && req.url === `/api/tasks/${createdId}`) {
        res.writeHead(204);
        return res.end();
      }
      sendJson(res, 404, {});
    });

    const plan = {
      cases: [
        { name: 'Listar tarefas', method: 'GET', path: '/api/tasks', expectedStatus: '200', expect: 'list' },
        {
          name: 'Criar tarefa',
          method: 'POST',
          path: '/api/tasks',
          body: { title: 'Nova' },
          expectedStatus: '201',
          expect: 'object-id',
          captureAs: 'createdId'
        },
        {
          name: 'Criar sem título falha',
          method: 'POST',
          path: '/api/tasks',
          body: {},
          expectedStatus: '4xx',
          expect: 'none'
        },
        {
          name: 'Marcar concluída',
          method: 'PUT',
          path: '/api/tasks/{createdId}',
          body: { completed: true },
          expectedStatus: '200',
          expect: 'field:completed=true'
        },
        { name: 'Deletar tarefa', method: 'DELETE', path: '/api/tasks/{createdId}', expectedStatus: '204', expect: 'none' }
      ]
    };

    try {
      const result = await runGeneratedTests(plan, baseUrl, orchestrator);
      assert.equal(result.passed, true, JSON.stringify(result.tests, null, 2));
      assert.equal(result.tests.length, 5);
    } finally {
      await closeServer(server);
    }
  });

  it('encadeia captura de token de login e usa em rota autenticada', async () => {
    const { server, baseUrl } = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/auth/login') {
        return sendJson(res, 200, { accessToken: 'tok-xyz' });
      }
      if (req.method === 'GET' && req.url === '/api/auth/me') {
        const auth = req.headers.authorization;
        if (auth === 'Bearer tok-xyz') return sendJson(res, 200, { user: { id: 'u1' } });
        return sendJson(res, 401, { error: 'unauthorized' });
      }
      sendJson(res, 404, {});
    });

    const plan = {
      cases: [
        {
          name: 'Login',
          method: 'POST',
          path: '/api/auth/login',
          body: { email: 'a@b.com', password: 'x' },
          expectedStatus: '200',
          expect: 'token',
          captureAs: 'loginToken'
        },
        { name: 'Rota protegida com token', method: 'GET', path: '/api/auth/me', auth: true, expectedStatus: '200', expect: 'none' }
      ]
    };

    try {
      const result = await runGeneratedTests(plan, baseUrl, orchestrator);
      assert.equal(result.passed, true, JSON.stringify(result.tests, null, 2));
    } finally {
      await closeServer(server);
    }
  });

  it('pula caso que depende de variável nunca capturada (etapa anterior falhou)', async () => {
    const { server, baseUrl } = await startServer((req, res) => {
      sendJson(res, 400, { error: 'sempre falha' });
    });

    const plan = {
      cases: [
        { name: 'Criar', method: 'POST', path: '/api/tasks', body: {}, expectedStatus: '201', expect: 'object-id', captureAs: 'id' },
        { name: 'Deletar', method: 'DELETE', path: '/api/tasks/{id}', expectedStatus: '204', expect: 'none' }
      ]
    };

    try {
      const result = await runGeneratedTests(plan, baseUrl, orchestrator);
      assert.equal(result.passed, false);
      assert.equal(result.tests[0].passed, false);
      assert.match(result.tests[1].error, /Ignorado: variável \{id\}/);
    } finally {
      await closeServer(server);
    }
  });

  it('ignora casos inválidos do plano (path sem barra, método desconhecido) em vez de quebrar', async () => {
    const { server, baseUrl } = await startServer((req, res) => sendJson(res, 200, []));
    const plan = {
      cases: [
        { name: 'inválido', method: 'GET', path: 'sem-barra' },
        { name: 'inválido2', method: 'TRACE', path: '/x' },
        { name: 'válido', method: 'GET', path: '/api/x', expectedStatus: '200', expect: 'none' }
      ]
    };
    try {
      const result = await runGeneratedTests(plan, baseUrl, orchestrator);
      assert.equal(result.tests.length, 1);
      assert.equal(result.tests[0].passed, true);
    } finally {
      await closeServer(server);
    }
  });

  it('plano vazio/sem cases não quebra — só reporta reprovado com zero testes', async () => {
    const result = await runGeneratedTests({}, 'http://127.0.0.1:1', orchestrator);
    assert.equal(result.passed, false);
    assert.deepEqual(result.tests, []);
  });

  it('status 500 continua reprovando mesmo com expect "none"', async () => {
    const { server, baseUrl } = await startServer((req, res) => sendJson(res, 500, { ok: true }));
    const plan = { cases: [{ name: 'quebra', method: 'GET', path: '/x', expectedStatus: '2xx', expect: 'none' }] };
    try {
      const result = await runGeneratedTests(plan, baseUrl, orchestrator);
      assert.equal(result.tests[0].passed, false);
    } finally {
      await closeServer(server);
    }
  });
});
