const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'test-token-forja-control-plane';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'true';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cp-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-cp-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3098';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('STAGE_LABELS control plane', () => {
  it('includes human, userFix, prodReady and report', () => {
    const { STAGE_LABELS } = fresh('../agent/orchestrator');
    for (const key of ['human', 'userFix', 'prodReady', 'report', 'deploy', 'qa']) {
      assert.ok(STAGE_LABELS[key], `missing stage ${key}`);
    }
  });
});

describe('deployRuntime', () => {
  it('detects start command from package.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dep-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { start: 'node src/server.js' } })
    );
    const { detectStartCommand } = fresh('../lib/deployRuntime');
    const start = detectStartCommand(dir);
    assert.deepEqual(start, { cmd: 'node', args: ['src/server.js'] });
  });

  it('builds production Dockerfile with fixed container PORT 3000', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-df-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { start: 'node server.js' } })
    );
    const { buildProdDockerfile, CONTAINER_PORT } = fresh('../lib/deployRuntime');
    const df = buildProdDockerfile(dir, { cmd: 'node', args: ['server.js'] });
    assert.match(df, /FROM node:20-slim/);
    assert.match(df, new RegExp(`ENV PORT=${CONTAINER_PORT}`));
    assert.match(df, /NODE_ENV=production/);
    assert.match(df, /\["node","server\.js"\]/);
  });

  it('fail-closed when Docker required but unavailable', async () => {
    const deployRuntime = fresh('../lib/deployRuntime');
    const original = deployRuntime.verifyDocker;
    deployRuntime.verifyDocker = async () => false;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-nodock-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { start: 'node server.js' } })
    );
    fs.writeFileSync(path.join(dir, 'server.js'), 'console.log("hi")');
    try {
      await assert.rejects(
        () =>
          deployRuntime.startDeploy({
            deployDir: dir,
            hostPort: 5199,
            env: { JWT_SECRET: 'x'.repeat(32) },
            orchestrator: { log() {}, throwIfAborted() {} }
          }),
        /Docker|FORJA_REQUIRE_DOCKER/i
      );
    } finally {
      deployRuntime.verifyDocker = original;
    }
  });
});

describe('productionChecklist', () => {
  let fixtureDir;

  before(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-prodcheck-'));
    fs.writeFileSync(
      path.join(fixtureDir, 'package.json'),
      JSON.stringify(
        {
          name: 'demo',
          scripts: { start: 'node server.js' }
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(fixtureDir, 'server.js'),
      `const http = require('http');
const port = Number(process.env.PORT || 3000);
http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.end('ok');
}).listen(port);
`
    );
  });

  it('writes missing prod artifacts and fails without live health/human/qa', async () => {
    const { evaluateProductionReady } = fresh('../lib/productionChecklist');
    const result = await evaluateProductionReady({
      deployDir: fixtureDir,
      deployUrl: 'http://127.0.0.1:1',
      relativeTarget: 'demo',
      task: { tests: [], securityIssues: [], humanReport: { passed: false } },
      writeArtifacts: true
    });
    assert.equal(result.ready, false);
    assert.ok(fs.existsSync(path.join(fixtureDir, 'Dockerfile')));
    assert.ok(fs.existsSync(path.join(fixtureDir, '.dockerignore')));
    assert.ok(fs.existsSync(path.join(fixtureDir, '.env.example')));
    assert.ok(fs.existsSync(path.join(fixtureDir, 'PRODUCTION.md')));
    const ids = result.checks.filter((c) => !c.ok).map((c) => c.id);
    assert.ok(ids.includes('qa-green'));
    assert.ok(ids.includes('human-passed'));
    assert.ok(ids.includes('live-health'));
  });

  it('passes when gates and live health are green', async () => {
    const server = require('http').createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const { evaluateProductionReady } = fresh('../lib/productionChecklist');
    try {
      const result = await evaluateProductionReady({
        deployDir: fixtureDir,
        deployUrl: `http://127.0.0.1:${port}`,
        relativeTarget: 'demo',
        task: {
          tests: [
            { name: 'a', passed: true },
            { name: 'b', passed: true }
          ],
          securityIssues: [],
          humanReport: { passed: true },
          performanceMetrics: { successRate: 95 }
        },
        writeArtifacts: false
      });
      assert.equal(result.ready, true, result.summary);
      assert.equal(result.checks.filter((c) => !c.ok).length, 0);
    } finally {
      server.close();
    }
  });

  it('blocks on HIGH security findings', async () => {
    const server = require('http').createServer((_req, res) => {
      res.writeHead(200);
      res.end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const { evaluateProductionReady } = fresh('../lib/productionChecklist');
    try {
      const result = await evaluateProductionReady({
        deployDir: fixtureDir,
        deployUrl: `http://127.0.0.1:${port}`,
        relativeTarget: 'demo',
        task: {
          tests: [{ name: 'a', passed: true }],
          securityIssues: [{ id: 'S1', severity: 'HIGH', title: 'xss' }],
          humanReport: { passed: true },
          performanceMetrics: { successRate: 99 }
        },
        writeArtifacts: false
      });
      assert.equal(result.ready, false);
      assert.ok(result.checks.some((c) => c.id === 'security-clean' && !c.ok));
    } finally {
      server.close();
    }
  });

  it('achado real: não bloqueia por senha literal em fixture de teste (ADR-011 reintroduzido aqui)', async () => {
    // Mesmo caso exato do ADR-011: `const password = "Abc!2345"` num arquivo __tests__/*.test.js
    // não é um segredo — é um fixture de teste. Um scanner sem os fixes do ADR-011 (duplicado
    // aqui antes desta correção) reintroduz o falso positivo já resolvido em lib/secretScan.js.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-prodcheck-fixture-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { start: 'node server.js' } })
    );
    fs.writeFileSync(
      path.join(dir, 'server.js'),
      `const http = require('http');\nconst port = Number(process.env.PORT || 3000);\nhttp.createServer((req, res) => res.end('ok')).listen(port);\n`
    );
    fs.mkdirSync(path.join(dir, '__tests__'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '__tests__', 'login.test.js'),
      `test('login', () => { const password = "Abc!2345"; expect(login(password)).toBe(true); });\n`
    );
    const { evaluateProductionReady } = fresh('../lib/productionChecklist');
    const result = await evaluateProductionReady({
      deployDir: dir,
      deployUrl: 'http://127.0.0.1:1',
      relativeTarget: 'demo',
      task: { tests: [{ name: 'a', passed: true }], securityIssues: [], humanReport: { passed: true } },
      writeArtifacts: false
    });
    const secretsCheck = result.checks.find((c) => c.id === 'no-hardcoded-secrets');
    assert.equal(secretsCheck.ok, true, secretsCheck.detail);
  });

  it('ainda detecta um segredo real fora de arquivo de teste', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-prodcheck-real-secret-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo' }));
    fs.writeFileSync(
      path.join(dir, 'config.js'),
      `module.exports = { anthropicKey: "sk-ant-${'a'.repeat(24)}" };\n`
    );
    const { evaluateProductionReady } = fresh('../lib/productionChecklist');
    const result = await evaluateProductionReady({
      deployDir: dir,
      deployUrl: 'http://127.0.0.1:1',
      relativeTarget: 'demo',
      task: { tests: [], securityIssues: [], humanReport: { passed: false } },
      writeArtifacts: false
    });
    const secretsCheck = result.checks.find((c) => c.id === 'no-hardcoded-secrets');
    assert.equal(secretsCheck.ok, false);
    assert.match(secretsCheck.detail, /config\.js/);
  });
});

describe('human heuristic journey', () => {
  it('execute returns session steps against a tiny live server', async () => {
    const server = require('http').createServer((req, res) => {
      const url = req.url || '/';
      if (url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (url === '/api/documents') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ documents: [] }));
      }
      if (url.startsWith('/api/ingest') && req.method === 'POST') {
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (url.startsWith('/api/query') && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ hits: [] }));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<html><head><title>Demo</title></head><body><button>Perguntar</button><script>fetch("/api/health");fetch("/api/documents");fetch("/api/ingest/text");fetch("/api/query");</script></body></html>'
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    delete require.cache[require.resolve('../lib/llm')];
    delete require.cache[require.resolve('../lib/seniorEngineer')];
    delete require.cache[require.resolve('../agent/human')];
    const llm = require('../lib/llm');
    const original = llm.generateJson;
    llm.generateJson = async () => {
      throw new Error('forced heuristic');
    };
    const human = require('../agent/human');
    const orch = {
      log() {},
      throwIfAborted() {},
      getSignal() {
        return undefined;
      },
      recordTokens() {}
    };

    try {
      const report = await human.execute(
        `http://127.0.0.1:${port}`,
        [
          {
            path: 'src/routes.js',
            content:
              "router.get('/health'); router.get('/documents'); router.post('/ingest/text'); router.post('/query');"
          },
          {
            path: 'public/index.html',
            content: '<html><title>Demo</title><script>fetch("/api/query")</script></html>'
          }
        ],
        { llmProvider: 'ollama', useOllama: true, ollamaModel: 'none' },
        orch
      );
      assert.equal(report.passed, true, JSON.stringify(report.issues));
      assert.ok(report.session?.steps?.length >= 2);
      assert.ok(report.session.steps.every((s) => s.ok));
    } finally {
      llm.generateJson = original;
      server.close();
    }
  });
});

describe('human execute — verificação real de navegador (Playwright, ADR-022, achado real)', () => {
  it('reprova mesmo com TODOS os passos HTTP ok, quando a página renderiza em branco num navegador de verdade', async () => {
    const server = require('http').createServer((req, res) => {
      const url = req.url || '/';
      if (url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      // A raiz responde 200 (o teste HTTP por status passaria), mas o <body> fica vazio — só um
      // navegador real detecta isso; um teste só por fetch/status nunca pegaria.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>Vazio</title></head><body></body></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    delete require.cache[require.resolve('../lib/llm')];
    delete require.cache[require.resolve('../lib/seniorEngineer')];
    delete require.cache[require.resolve('../agent/human')];
    const llm = require('../lib/llm');
    const original = llm.generateJson;
    llm.generateJson = async () => {
      throw new Error('forced heuristic'); // isola do plano/revisão do LLM — só quer o browser check
    };
    const human = require('../agent/human');
    const orch = { log() {}, throwIfAborted() {}, getSignal: () => undefined, recordTokens() {} };

    try {
      const report = await human.execute(`http://127.0.0.1:${port}`, [], { llmProvider: 'ollama', useOllama: true }, orch);
      assert.equal(report.passed, false, 'página em branco deveria reprovar mesmo com HTTP 200 em tudo');
      assert.ok(report.browserCheck.available, 'playwright deveria estar disponível nesta máquina de teste');
      assert.equal(report.browserCheck.ok, false);
      assert.ok(report.issues.some((i) => i.id === 'UX-BLANK-PAGE'));
    } finally {
      llm.generateJson = original;
      server.close();
    }
  });
});

describe('human gate de aprovação — verdict do senior review (achado real)', () => {
  it('reprova mesmo com o fluxo limpo quando o verdict vem em formatação diferente ("Reprovado", maiúsculo)', async () => {
    const server = require('http').createServer((req, res) => {
      const url = req.url || '/';
      if (url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head><title>Demo</title></head><body><script>fetch("/api/health")</script></body></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    delete require.cache[require.resolve('../lib/llm')];
    delete require.cache[require.resolve('../lib/seniorEngineer')];
    delete require.cache[require.resolve('../agent/human')];
    const llm = require('../lib/llm');
    const original = llm.generateJson;
    let callCount = 0;
    llm.generateJson = async () => {
      callCount += 1;
      if (callCount === 1) {
        // Primeira chamada é o plano da jornada — força o caminho heurístico (mesmo padrão do
        // teste "human heuristic journey" acima), pra isolar só o gate de aprovação final.
        throw new Error('forced heuristic for planning');
      }
      // Segunda chamada é a revisão sênior (thinkAsSenior) — verdict de rejeição, mas NÃO o
      // literal exato 'reprovado' que o código antigo comparava (era case-sensitive e exigia
      // igualdade estrita). Antes desta correção, isso passava batido mesmo sendo uma rejeição.
      return {
        data: { verdict: 'Reprovado', summary: 'Rejeitado por inconsistência de UX', issues: [] },
        tokens: null,
        provider: 'test',
        model: 'test'
      };
    };
    const human = require('../agent/human');
    const orch = { log() {}, throwIfAborted() {}, getSignal: () => undefined, recordTokens() {} };

    try {
      const report = await human.execute(
        `http://127.0.0.1:${port}`,
        [{ path: 'src/routes.js', content: "router.get('/health');" }],
        { llmProvider: 'ollama', useOllama: true, ollamaModel: 'none' },
        orch
      );
      assert.equal(report.passed, false, 'verdict "Reprovado" (maiúsculo) deveria reprovar mesmo com o fluxo limpo');
    } finally {
      llm.generateJson = original;
      server.close();
    }
  });
});

describe('human httpStep — bloqueio de SSRF/exfiltração de credencial (achado real)', () => {
  it('segue path relativo normalmente, anexando cookie', async () => {
    const server = require('http').createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=abc' });
      res.end(JSON.stringify({ receivedCookie: req.headers.cookie || null }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const human = fresh('../agent/human');
    const jar = { header: () => 'sid=abc', absorb: () => {} };
    try {
      const result = await human.__test__.httpStep(`http://127.0.0.1:${port}`, { path: '/x' }, { log: () => {} }, jar);
      assert.equal(result.ok, true);
      assert.equal(result.json.receivedCookie, 'sid=abc');
    } finally {
      server.close();
    }
  });

  it('bloqueia URL absoluta pra outro host, sem chegar a fazer a requisição nem anexar cookie', async () => {
    let hit = false;
    const attacker = require('http').createServer((req, res) => {
      hit = true;
      res.writeHead(200);
      res.end('deveria não ter chegado aqui');
    });
    await new Promise((resolve) => attacker.listen(0, '127.0.0.1', resolve));
    const { port: attackerPort } = attacker.address();
    const human = fresh('../agent/human');
    const jar = { header: () => 'sid=segredo-de-sessao', absorb: () => {} };
    try {
      const result = await human.__test__.httpStep(
        'http://127.0.0.1:9', // base (deploy sob teste) — porta que nem existe, não deveria ser usada mesmo
        { path: `http://127.0.0.1:${attackerPort}/collect` },
        { log: () => {} },
        jar
      );
      assert.equal(result.ok, false);
      assert.match(result.failure, /URL absoluta fora do host testado/);
      assert.equal(hit, false, 'a requisição pro host externo nunca deveria ter sido feita');
    } finally {
      attacker.close();
    }
  });

  it('permite URL absoluta quando é exatamente o mesmo host do deploy', async () => {
    const server = require('http').createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cookie: req.headers.cookie || null }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const human = fresh('../agent/human');
    const jar = { header: () => 'sid=abc', absorb: () => {} };
    try {
      const result = await human.__test__.httpStep(
        `http://127.0.0.1:${port}`,
        { path: `http://127.0.0.1:${port}/same-host` },
        { log: () => {} },
        jar
      );
      assert.equal(result.ok, true);
      assert.equal(result.json.cookie, 'sid=abc');
    } finally {
      server.close();
    }
  });
});

describe('validation schemas', () => {
  it('accepts user report and rejects empty', () => {
    const { userReportSchema, parseOrThrow } = fresh('../lib/validation');
    const ok = parseOrThrow(userReportSchema, { message: 'botão quebrado' });
    assert.equal(ok.message, 'botão quebrado');
    assert.throws(() => parseOrThrow(userReportSchema, { message: '  ' }), /erro|vazio|min/i);
  });
});

describe('devops deploy contract', () => {
  it('exports deploy that uses runtime helpers', () => {
    const devops = fresh('../agent/devops');
    assert.equal(typeof devops.deploy, 'function');
    assert.equal(typeof devops.killDeploy, 'function');
    const runtime = fresh('../lib/deployRuntime');
    assert.equal(typeof runtime.startDeploy, 'function');
    assert.equal(typeof runtime.stopDeploy, 'function');
  });
});
