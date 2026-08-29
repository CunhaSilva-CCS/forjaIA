const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

process.env.FORJA_API_TOKEN = 'mobile-human-test-token-24char';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-mobile-human-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-mobile-human-${Date.now()}.db`);

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('runMobileHumanTest — sem simulatorUdid/bundleId', () => {
  it('degrada graciosamente sem tentar conectar em nada', async () => {
    const { runMobileHumanTest } = fresh('../lib/mobileHumanTest');
    const result = await runMobileHumanTest({ runConfig: {}, orchestrator: { log: () => {} } });
    assert.equal(result.available, false);
    assert.equal(result.ok, true);
    assert.match(result.skippedReason, /simulatorUdid\/bundleId/);
  });
});

describe('runMobileHumanTest — servidor Appium indisponível (achado real: nenhum SDK, HTTP puro)', () => {
  it('degrada graciosamente contra uma porta fechada de verdade, sem travar o pipeline', async () => {
    process.env.FORJA_APPIUM_URL = 'http://127.0.0.1:1';
    try {
      const { runMobileHumanTest } = fresh('../lib/mobileHumanTest');
      const result = await runMobileHumanTest({
        simulatorUdid: 'UDID-1',
        bundleId: 'com.forja.demo',
        runConfig: {},
        orchestrator: { log: () => {} }
      });
      assert.equal(result.available, false);
      assert.equal(result.ok, true);
      assert.match(result.skippedReason, /servidor Appium não respondeu/);
    } finally {
      delete process.env.FORJA_APPIUM_URL;
    }
  });
});

describe('extractLabels', () => {
  it('extrai rótulos de acessibilidade (label e name) de um XML de árvore XCUITest', () => {
    const { extractLabels } = fresh('../lib/mobileHumanTest');
    const xml = `<XCUIElementTypeApplication name="Demo">
      <XCUIElementTypeButton label="Começar" name="btn-comecar" />
      <XCUIElementTypeStaticText label="Bem-vindo" />
    </XCUIElementTypeApplication>`;
    const labels = extractLabels(xml);
    assert.ok(labels.includes('Começar'));
    assert.ok(labels.includes('btn-comecar'));
    assert.ok(labels.includes('Bem-vindo'));
    assert.ok(labels.includes('Demo'));
  });

  it('não quebra com XML vazio ou indefinido', () => {
    const { extractLabels } = fresh('../lib/mobileHumanTest');
    assert.deepEqual(extractLabels(''), []);
    assert.deepEqual(extractLabels(undefined), []);
  });
});

describe('runMobileHumanTest — achado real: contra um servidor Appium fake que fala o protocolo de verdade', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-mobile-project-'));

  // Cada teste sobe seu próprio servidor fake e fecha no final — um `after()` único e
  // compartilhado deixaria os servidores dos testes anteriores vazando (socket aberto), o que
  // trava `node --test` esperando o event loop drenar em vez de sair.
  function startFakeAppium(handler) {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
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

  function closeFakeAppium(server) {
    return new Promise((resolve) => server.close(() => resolve()));
  }

  function sendJson(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ value }));
  }

  it('sessão sem elementos na árvore de acessibilidade vira achado CRITICAL (equivalente mobile de UX-BLANK-PAGE)', async () => {
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    ).toString('base64');
    const { server, baseUrl } = await startFakeAppium((req, res) => {
      if (req.url === '/status') return sendJson(res, 200, { ready: true });
      if (req.method === 'POST' && req.url === '/session') return sendJson(res, 200, { sessionId: 'sess-1' });
      if (req.url === '/session/sess-1/screenshot') return sendJson(res, 200, onePxPng);
      if (req.url === '/session/sess-1/source') return sendJson(res, 200, '<XCUIElementTypeApplication></XCUIElementTypeApplication>');
      if (req.method === 'DELETE' && req.url === '/session/sess-1') return sendJson(res, 200, null);
      sendJson(res, 404, { error: 'not found', message: `sem handler pra ${req.method} ${req.url}` });
    });
    process.env.FORJA_APPIUM_URL = baseUrl;
    try {
      const { runMobileHumanTest } = fresh('../lib/mobileHumanTest');
      const result = await runMobileHumanTest({
        simulatorUdid: 'UDID-1',
        bundleId: 'com.forja.demo',
        runConfig: { targetPath: workDir },
        orchestrator: { log: () => {} }
      });
      assert.equal(result.available, true);
      assert.equal(result.ok, false);
      assert.ok(result.issues.some((i) => i.id === 'UX-MOBILE-BLANK-SCREEN' && i.severity === 'CRITICAL'));
      assert.equal(result.screenshots.length, 1);
      assert.ok(fs.existsSync(result.screenshots[0]));
      assert.ok(fs.statSync(result.screenshots[0]).size > 0);
    } finally {
      delete process.env.FORJA_APPIUM_URL;
      await closeFakeAppium(server);
    }
  });

  it('achado real: encontra um botão plausível na árvore, toca de verdade e tira o screenshot de depois', async () => {
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    ).toString('base64');
    let clickedElementId = null;
    const { server, baseUrl } = await startFakeAppium((req, res, body) => {
      if (req.url === '/status') return sendJson(res, 200, { ready: true });
      if (req.method === 'POST' && req.url === '/session') return sendJson(res, 200, { sessionId: 'sess-2' });
      if (req.url === '/session/sess-2/screenshot') return sendJson(res, 200, onePxPng);
      if (req.url === '/session/sess-2/source') {
        return sendJson(res, 200, '<XCUIElementTypeButton label="Começar" name="btn" /><XCUIElementTypeStaticText label="Bem-vindo" />');
      }
      if (req.method === 'POST' && req.url === '/session/sess-2/element') {
        assert.match(body.value, /label == 'Começar'/);
        return sendJson(res, 200, { ELEMENT: 'el-1' });
      }
      if (req.method === 'POST' && req.url === '/session/sess-2/element/el-1/click') {
        clickedElementId = 'el-1';
        return sendJson(res, 200, null);
      }
      if (req.method === 'DELETE' && req.url === '/session/sess-2') return sendJson(res, 200, null);
      sendJson(res, 404, { error: 'not found', message: `sem handler pra ${req.method} ${req.url}` });
    });
    process.env.FORJA_APPIUM_URL = baseUrl;
    try {
      const { runMobileHumanTest } = fresh('../lib/mobileHumanTest');
      const result = await runMobileHumanTest({
        simulatorUdid: 'UDID-1',
        bundleId: 'com.forja.demo',
        runConfig: { targetPath: workDir },
        orchestrator: { log: () => {} }
      });
      assert.equal(result.available, true);
      assert.equal(result.ok, true, JSON.stringify(result.issues));
      assert.equal(result.clickedLabel, 'Começar');
      assert.equal(clickedElementId, 'el-1');
      assert.equal(result.screenshots.length, 2);
    } finally {
      delete process.env.FORJA_APPIUM_URL;
      await closeFakeAppium(server);
    }
  });

  it('achado real: falha ao criar sessão (ex.: app não instalado) vira HIGH, não trava, e fecha sessão só se ela existir', async () => {
    const { server, baseUrl } = await startFakeAppium((req, res) => {
      if (req.url === '/status') return sendJson(res, 200, { ready: true });
      if (req.method === 'POST' && req.url === '/session') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ value: { error: 'session not created', message: 'app não instalado no simulador' } }));
      }
      sendJson(res, 404, { error: 'not found' });
    });
    process.env.FORJA_APPIUM_URL = baseUrl;
    try {
      const { runMobileHumanTest } = fresh('../lib/mobileHumanTest');
      const result = await runMobileHumanTest({
        simulatorUdid: 'UDID-1',
        bundleId: 'com.forja.demo',
        runConfig: { targetPath: workDir },
        orchestrator: { log: () => {} }
      });
      assert.equal(result.available, true);
      assert.equal(result.ok, false);
      assert.ok(result.issues.some((i) => i.id === 'UX-MOBILE-SESSION-FAILED' && i.severity === 'HIGH'));
      assert.match(result.issues[0].description, /app não instalado/);
    } finally {
      delete process.env.FORJA_APPIUM_URL;
      await closeFakeAppium(server);
    }
  });
});
