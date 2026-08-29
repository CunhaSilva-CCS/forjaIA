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

describe('extractTappableLabels (achado real, verificado ao vivo contra um app React Native de verdade no Simulador)', () => {
  it('ignora texto estático mesmo quando accessible="true" (VoiceOver expõe título como acessível, mas não é tocável)', () => {
    const { extractTappableLabels } = fresh('../lib/mobileHumanTest');
    // Mesma forma da árvore real capturada: o MESMO texto aparece duas vezes (nó "cru" +
    // representação de navegação do VoiceOver), a segunda com accessible="true".
    const xml = `
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="Entrar no App" name="Entrar no App" enabled="true" visible="true" accessible="false">
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="Entrar no App" name="Entrar no App" enabled="true" visible="true" accessible="true">
    `;
    assert.deepEqual(extractTappableLabels(xml), []);
  });

  it('inclui um elemento XCUIElementTypeOther tocável — o tipo real que Pressable/TouchableOpacity do RN vira no iOS', () => {
    const { extractTappableLabels } = fresh('../lib/mobileHumanTest');
    const xml = `<XCUIElementTypeOther type="XCUIElementTypeOther" label="Criar conta" name="Criar conta" enabled="true" visible="true" accessible="true" x="39" y="560">`;
    assert.deepEqual(extractTappableLabels(xml), ['Criar conta']);
  });

  it('ignora elemento desabilitado (enabled="false") mesmo que seja tocável em tipo/accessible', () => {
    const { extractTappableLabels } = fresh('../lib/mobileHumanTest');
    const xml = `<XCUIElementTypeOther type="XCUIElementTypeOther" label="Enviar" name="Enviar" enabled="false" visible="true" accessible="true">`;
    assert.deepEqual(extractTappableLabels(xml), []);
  });

  it('ignora campo de texto/senha e imagem, mesmo accessible e enabled', () => {
    const { extractTappableLabels } = fresh('../lib/mobileHumanTest');
    const xml = `
      <XCUIElementTypeTextField type="XCUIElementTypeTextField" label="Email" name="Email" enabled="true" visible="true" accessible="true">
      <XCUIElementTypeSecureTextField type="XCUIElementTypeSecureTextField" label="Senha" name="Senha" enabled="true" visible="true" accessible="true">
      <XCUIElementTypeImage type="XCUIElementTypeImage" label="Logo" name="Logo" enabled="true" visible="true" accessible="true">
    `;
    assert.deepEqual(extractTappableLabels(xml), []);
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

  it('achado real: ignora texto estático "acessível" (VoiceOver) e toca no elemento realmente tocável, tira o screenshot de depois', async () => {
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
        // Mesma forma da árvore real: um título estático "Entrar..." também bateria no regex de
        // CTA, mas não é tocável — só o XCUIElementTypeOther com accessible+enabled deve ser
        // escolhido.
        return sendJson(
          res,
          200,
          '<XCUIElementTypeStaticText type="XCUIElementTypeStaticText" label="Entrar no App" name="Entrar no App" enabled="true" visible="true" accessible="true">' +
            '<XCUIElementTypeOther type="XCUIElementTypeOther" label="Começar" name="btn" enabled="true" visible="true" accessible="true">'
        );
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

describe('runMobileHumanTest — sem os identificadores certos pra Android', () => {
  it('degrada graciosamente sem emulatorSerial/androidPackage', async () => {
    const { runMobileHumanTest } = fresh('../lib/mobileHumanTest');
    const result = await runMobileHumanTest({ platform: 'android', runConfig: {}, orchestrator: { log: () => {} } });
    assert.equal(result.available, false);
    assert.equal(result.ok, true);
    assert.match(result.skippedReason, /emulatorSerial\/androidPackage/);
  });
});

describe('extractTappableLabels (Android) — achado real, verificado ao vivo contra um app RN/Compose de verdade num emulador', () => {
  it('achado real #1: ignora texto NÃO clicável (título/label decorativo)', () => {
    const { extractTappableLabels } = fresh('../lib/mobileHumanTest');
    const xml = `<android.widget.TextView index="1" text="Confirme o PIN" clickable="false" enabled="true" content-desc="" />`;
    assert.deepEqual(extractTappableLabels(xml, 'android'), []);
  });

  it('achado real #2: o XML real do Appium usa o NOME DA CLASSE como tag (não <node>) — prioriza content-desc sobre text', () => {
    const { extractTappableLabels } = fresh('../lib/mobileHumanTest');
    // Mesma forma exata capturada ao vivo: o texto visível ("1") fica num TextView FILHO
    // clickable="false" separado — o content-desc do botão PAI ("Dígito 1") é o rótulo certo.
    const xml = `<android.widget.Button index="9" text="" content-desc="Dígito 1" clickable="true" enabled="true"><android.widget.TextView index="1" text="1" content-desc="" clickable="false" enabled="true" /></android.widget.Button>`;
    assert.deepEqual(extractTappableLabels(xml, 'android'), ['Dígito 1']);
  });

  it('cai pro atributo text quando content-desc vem vazio', () => {
    const { extractTappableLabels } = fresh('../lib/mobileHumanTest');
    const xml = `<android.widget.Button index="0" text="Criar conta" content-desc="" clickable="true" enabled="true" />`;
    assert.deepEqual(extractTappableLabels(xml, 'android'), ['Criar conta']);
  });

  it('ignora elemento desabilitado mesmo que clicável', () => {
    const { extractTappableLabels } = fresh('../lib/mobileHumanTest');
    const xml = `<android.widget.Button index="0" text="" content-desc="Enviar" clickable="true" enabled="false" />`;
    assert.deepEqual(extractTappableLabels(xml, 'android'), []);
  });

  it('a tag raiz <hierarchy> (sem clickable) nunca é confundida com um elemento tocável', () => {
    const { extractTappableLabels } = fresh('../lib/mobileHumanTest');
    const xml = `<hierarchy index="0" class="hierarchy" rotation="0"><android.widget.Button index="0" text="" content-desc="Entrar" clickable="true" enabled="true" /></hierarchy>`;
    assert.deepEqual(extractTappableLabels(xml, 'android'), ['Entrar']);
  });
});

describe('runMobileHumanTest — Android, achado real: contra um servidor Appium fake que fala o protocolo UiAutomator2', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-mobile-android-project-'));

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

  it('achado real: toca no botão certo via -android uiautomator, ignorando o texto não clicável que também bateria no regex de CTA', async () => {
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    ).toString('base64');
    let clickedElementId = null;
    const { server, baseUrl } = await startFakeAppium((req, res, body) => {
      if (req.url === '/status') return sendJson(res, 200, { ready: true });
      if (req.method === 'POST' && req.url === '/session') return sendJson(res, 200, { sessionId: 'sess-android-1' });
      if (req.url === '/session/sess-android-1/screenshot') return sendJson(res, 200, onePxPng);
      if (req.url === '/session/sess-android-1/source') {
        return sendJson(
          res,
          200,
          `<hierarchy index="0" class="hierarchy"><android.widget.TextView index="0" text="Entrar no App" content-desc="" clickable="false" enabled="true" /><android.widget.Button index="1" text="" content-desc="Criar conta" clickable="true" enabled="true" /></hierarchy>`
        );
      }
      if (req.method === 'POST' && req.url === '/session/sess-android-1/element') {
        assert.equal(body.using, '-android uiautomator');
        assert.match(body.value, /descriptionContains\("Criar conta"\)/);
        return sendJson(res, 200, { ELEMENT: 'el-android-1' });
      }
      if (req.method === 'POST' && req.url === '/session/sess-android-1/element/el-android-1/click') {
        clickedElementId = 'el-android-1';
        return sendJson(res, 200, null);
      }
      if (req.method === 'DELETE' && req.url === '/session/sess-android-1') return sendJson(res, 200, null);
      sendJson(res, 404, { error: 'not found', message: `sem handler pra ${req.method} ${req.url}` });
    });
    process.env.FORJA_APPIUM_URL = baseUrl;
    try {
      const { runMobileHumanTest } = fresh('../lib/mobileHumanTest');
      const result = await runMobileHumanTest({
        platform: 'android',
        emulatorSerial: 'emulator-5554',
        androidPackage: 'com.forja.demo',
        runConfig: { targetPath: workDir },
        orchestrator: { log: () => {} }
      });
      assert.equal(result.available, true);
      assert.equal(result.ok, true, JSON.stringify(result.issues));
      assert.equal(result.clickedLabel, 'Criar conta');
      assert.equal(clickedElementId, 'el-android-1');
      assert.equal(result.screenshots.length, 2);
    } finally {
      delete process.env.FORJA_APPIUM_URL;
      await closeFakeAppium(server);
    }
  });
});
