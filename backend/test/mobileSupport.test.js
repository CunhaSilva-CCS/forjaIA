const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'mobile-test-token-with-24-chars-x';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-mobile-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-mobile-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3095';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

const expoPackageJson = JSON.stringify({
  name: 'secpass-like',
  dependencies: { expo: '^57.0.0', react: '19.2.3', 'react-native': '0.86.2' }
});
const mobileFiles = [{ path: 'package.json', content: expoPackageJson }];
const webFiles = [{ path: 'package.json', content: JSON.stringify({ name: 'x', dependencies: { express: '^4' } }) }];

describe('detectProjectType (ADR-014)', () => {
  it('identifica projeto Expo/React Native pelas dependências', () => {
    const { detectProjectType } = fresh('../lib/projectType');
    assert.equal(detectProjectType(mobileFiles), 'mobile-expo');
  });

  it('identifica react-native puro (sem expo) também como mobile-expo', () => {
    const { detectProjectType } = fresh('../lib/projectType');
    const files = [{ path: 'package.json', content: JSON.stringify({ dependencies: { 'react-native': '0.80.0' } }) }];
    assert.equal(detectProjectType(files), 'mobile-expo');
  });

  it('projeto web comum retorna "web"', () => {
    const { detectProjectType } = fresh('../lib/projectType');
    assert.equal(detectProjectType(webFiles), 'web');
  });

  it('sem package.json ou package.json inválido, retorna "web" (default seguro)', () => {
    const { detectProjectType } = fresh('../lib/projectType');
    assert.equal(detectProjectType([]), 'web');
    assert.equal(detectProjectType([{ path: 'package.json', content: 'not json' }]), 'web');
  });
});

describe('mobileTest.toReport/parseJestJson (ADR-014)', () => {
  it('converte resultado do Jest pro formato { passed, tests }', () => {
    const { toReport } = fresh('../lib/mobileTest');
    const jestResult = {
      success: false,
      testResults: [
        {
          assertionResults: [
            { fullName: 'vault encrypts and decrypts', status: 'passed' },
            { fullName: 'rejects weak password', status: 'failed', failureMessages: ['Expected true, got false'] },
            { fullName: 'skipped one', status: 'pending' }
          ]
        }
      ]
    };
    const report = toReport(jestResult);
    assert.equal(report.tests.length, 2);
    assert.equal(report.passed, false);
    assert.equal(report.tests[0].passed, true);
    assert.equal(report.tests[1].passed, false);
    assert.match(report.tests[1].error, /Expected true/);
  });

  it('extrai o JSON mesmo com ruído antes/depois na saída', () => {
    const { parseJestJson } = fresh('../lib/mobileTest');
    const raw = `console.warn: alguma coisa\n${JSON.stringify({ success: true, testResults: [] })}\n`;
    const parsed = parseJestJson(raw);
    assert.equal(parsed.success, true);
  });
});

describe('agent/security.js — DAST não se aplica a projeto mobile (ADR-014)', () => {
  it('não tenta sandbox HTTP nem gera achado SEC-DAST-UNAVAILABLE pra projeto mobile', async () => {
    const security = fresh('../agent/security');
    const sandboxRunner = fresh('../sandbox/runner');
    const originalStart = sandboxRunner.start;
    let sandboxStartCalled = false;
    sandboxRunner.start = async () => {
      sandboxStartCalled = true;
      throw new Error('não deveria ter sido chamado');
    };
    const originalFetch = global.fetch;
    // Sem isso, thinkAsSenior chamaria o Ollama de verdade (lento e dependente de infra local).
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ response: '{"verdict":"seguro","summary":"ok"}' })
    });
    const orchestrator = { log: () => {}, getSignal: () => undefined };
    try {
      const result = await security.execute(mobileFiles, {}, orchestrator);
      assert.equal(sandboxStartCalled, false);
      assert.ok(!result.issues.some((i) => i.id === 'SEC-DAST-UNAVAILABLE'));
    } finally {
      sandboxRunner.start = originalStart;
      global.fetch = originalFetch;
    }
  });

  // Achado real ao validar o secPass (ADR-011): o regex ORIGINAL de segredo (pré-existente, não
  // o secretScan.js novo) também batia em falso numa fixture de teste.
  it('não sinaliza SEC-SECRET pra senha literal de fixture em arquivo de teste', async () => {
    const security = fresh('../agent/security');
    const sandboxRunner = fresh('../sandbox/runner');
    const originalStart = sandboxRunner.start;
    sandboxRunner.start = async () => {
      throw new Error('sem sandbox nesse teste');
    };
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ response: '{"verdict":"seguro"}' }) });
    const orchestrator = { log: () => {}, getSignal: () => undefined };
    const files = [{ path: '__tests__/account.test.js', content: 'const password = "Abc!2345";' }];
    try {
      const result = await security.execute(files, {}, orchestrator);
      assert.ok(!result.issues.some((i) => i.id === 'SEC-SECRET'));
    } finally {
      sandboxRunner.start = originalStart;
      global.fetch = originalFetch;
    }
  });
});

describe('devops.js — deploy() roteia pra deployMobile em projeto mobile (ADR-014)', () => {
  it('chama deployMobile em vez do fluxo Docker/web', async () => {
    const devops = fresh('../agent/devops');
    const original = devops.deployMobile;
    let called = false;
    devops.deployMobile = async () => {
      called = true;
      return { url: null, path: 'x', runtime: 'ios-simulator' };
    };
    try {
      const orchestrator = { log: () => {} };
      const result = await devops.deploy(mobileFiles, {}, orchestrator);
      assert.equal(called, true);
      assert.equal(result.runtime, 'ios-simulator');
    } finally {
      devops.deployMobile = original;
    }
  });
});

describe('productionChecklist — não se aplica a projeto mobile (ADR-014)', () => {
  it('retorna ready:true trivialmente sem rodar checks web', async () => {
    const { evaluateProductionReady } = fresh('../lib/productionChecklist');
    const result = await evaluateProductionReady({
      deployDir: '/tmp/nao-existe-de-verdade',
      task: { files: mobileFiles },
      writeArtifacts: false
    });
    assert.equal(result.ready, true);
    assert.deepEqual(result.checks, []);
  });
});

describe('mobileDeploy.resolveBundleId (ADR-029) — pra runMobileHumanTest saber qual app abrir', () => {
  it('prioriza PRODUCT_BUNDLE_IDENTIFIER do pbxproj gerado pelo prebuild sobre o app.json', () => {
    const { resolveBundleId } = fresh('../lib/mobileDeploy');
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bundleid-pbx-'));
    fs.writeFileSync(path.join(projectDir, 'app.json'), JSON.stringify({ expo: { ios: { bundleIdentifier: 'com.appjson.velho' } } }));
    const iosDir = path.join(projectDir, 'ios', 'Demo.xcodeproj');
    fs.mkdirSync(iosDir, { recursive: true });
    fs.writeFileSync(
      path.join(iosDir, 'project.pbxproj'),
      'PRODUCT_BUNDLE_IDENTIFIER = com.forja.demo.real;\nOTHER_SETTING = 1;'
    );
    assert.equal(resolveBundleId(projectDir), 'com.forja.demo.real');
  });

  it('cai pro app.json quando não há pbxproj (prebuild ainda não rodou)', () => {
    const { resolveBundleId } = fresh('../lib/mobileDeploy');
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bundleid-appjson-'));
    fs.writeFileSync(path.join(projectDir, 'app.json'), JSON.stringify({ expo: { ios: { bundleIdentifier: 'com.forja.fallback' } } }));
    assert.equal(resolveBundleId(projectDir), 'com.forja.fallback');
  });

  it('retorna null sem quebrar quando não há pbxproj nem app.json com bundleIdentifier', () => {
    const { resolveBundleId } = fresh('../lib/mobileDeploy');
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bundleid-nada-'));
    assert.equal(resolveBundleId(projectDir), null);
  });
});
