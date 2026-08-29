const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-multiplat-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-multiplat-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3098';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

const mobileFiles = [
  { path: 'package.json', content: JSON.stringify({ dependencies: { expo: '^57.0.0' } }) }
];

describe('devops.deployMobile — orquestração multi-plataforma (ADR-018/031)', () => {
  it('sempre tenta Simulador iOS e emulador Android; pula Mac/Windows quando o projeto não tem suporte', async () => {
    const devops = fresh('../agent/devops');
    const mobileDeploy = fresh('../lib/mobileDeploy');
    const androidDeploy = fresh('../lib/androidDeploy');
    const windowsDeploy = fresh('../lib/windowsDeploy');

    mobileDeploy.deployToSimulator = async () => ({ type: 'ios-simulator', url: null, simulatorName: 'iPhone 17' });
    mobileDeploy.supportsMacCatalyst = async () => false;
    androidDeploy.deployToAndroidEmulator = async () => ({ type: 'android-emulator', url: null, emulatorSerial: 'emulator-5554' });
    windowsDeploy.supportsWindows = () => false;

    const orchestrator = { log: () => {} };
    const result = await devops.deployMobile(mobileFiles, {}, orchestrator);

    assert.equal(result.runtime, 'multi-platform');
    assert.equal(result.targets.length, 2);
    const byPlatform = Object.fromEntries(result.targets.map((t) => [t.platform, t]));
    assert.equal(byPlatform['ios-simulator'].ok, true);
    assert.equal(byPlatform['android-emulator'].ok, true);
  });

  it('achado real: tenta Mac e Windows quando o projeto sinaliza suporte, sem derrubar os outros alvos se um deles falhar', async () => {
    const devops = fresh('../agent/devops');
    const mobileDeploy = fresh('../lib/mobileDeploy');
    const androidDeploy = fresh('../lib/androidDeploy');
    const windowsDeploy = fresh('../lib/windowsDeploy');

    mobileDeploy.deployToSimulator = async () => ({ type: 'ios-simulator', url: null, simulatorName: 'iPhone 17' });
    mobileDeploy.supportsMacCatalyst = async () => true;
    mobileDeploy.deployToMac = async () => ({ type: 'mac-catalyst', url: null, target: 'My Mac' });
    androidDeploy.deployToAndroidEmulator = async () => {
      throw new Error('emulador Android não bootou a tempo neste teste');
    };
    windowsDeploy.supportsWindows = () => true;
    windowsDeploy.triggerWindowsBuild = async () => {
      throw new Error('build falhou de propósito neste teste');
    };

    const logs = [];
    const orchestrator = { log: (agent, msg, type) => logs.push({ msg, type }) };
    const result = await devops.deployMobile(mobileFiles, {}, orchestrator);

    assert.equal(result.targets.length, 4);
    const byPlatform = Object.fromEntries(result.targets.map((t) => [t.platform, t]));
    assert.equal(byPlatform['ios-simulator'].ok, true);
    assert.equal(byPlatform['android-emulator'].ok, false);
    assert.match(byPlatform['android-emulator'].error, /não bootou a tempo/);
    assert.equal(byPlatform.macos.ok, true);
    assert.equal(byPlatform.windows.ok, false);
    assert.match(byPlatform.windows.error, /build falhou de propósito/);
    assert.ok(logs.some((l) => /Deploy no emulador Android falhou/.test(l.msg) && l.type === 'warning'));
    assert.ok(logs.some((l) => /Build Windows falhou/.test(l.msg) && l.type === 'warning'));
  });

  it('achado real: falha no Simulador iOS não derruba o Android nem os outros alvos', async () => {
    const devops = fresh('../agent/devops');
    const mobileDeploy = fresh('../lib/mobileDeploy');
    const androidDeploy = fresh('../lib/androidDeploy');
    const windowsDeploy = fresh('../lib/windowsDeploy');

    mobileDeploy.deployToSimulator = async () => {
      throw new Error('nenhum Simulador de iPhone disponível neste teste');
    };
    mobileDeploy.supportsMacCatalyst = async () => false;
    androidDeploy.deployToAndroidEmulator = async () => ({ type: 'android-emulator', url: null, emulatorSerial: 'emulator-5554' });
    windowsDeploy.supportsWindows = () => false;

    const result = await devops.deployMobile(mobileFiles, {}, { log: () => {} });

    const byPlatform = Object.fromEntries(result.targets.map((t) => [t.platform, t]));
    assert.equal(byPlatform['ios-simulator'].ok, false);
    assert.equal(byPlatform['android-emulator'].ok, true);
  });
});

describe('deployStage.describeDeployTargets (ADR-018)', () => {
  it('monta uma descrição legível com os alvos que tiveram sucesso e sinaliza os que falharam', () => {
    const stage = fresh('../agent/stages/deployStage');
    // função não exportada diretamente — testa via comportamento observável do módulo:
    // chama run() com devops.deploy mockado e confere a mensagem gerada.
    const devops = fresh('../agent/devops');
    devops.deploy = async () => ({
      url: null,
      runtime: 'multi-platform',
      targets: [
        { platform: 'ios-simulator', ok: true, simulatorName: 'iPhone 17' },
        { platform: 'android-emulator', ok: false, error: 'y' },
        { platform: 'macos', ok: true, target: 'My Mac' },
        { platform: 'windows', ok: false, error: 'x' }
      ]
    });
    const messages = [];
    const orchestrator = {
      throwIfAborted: () => {},
      broadcast: () => {},
      log: (agent, msg) => messages.push(msg),
      currentTask: { files: [] },
      persistTask: () => {},
      pauseForApproval: async (nextStage, msg) => messages.push(msg)
    };
    return stage.run(orchestrator, {}).then(() => {
      const combined = messages.join(' | ');
      assert.match(combined, /Simulador \(iPhone 17\)/);
      assert.match(combined, /Emulador Android \(falhou\)/);
      assert.match(combined, /macOS \(Catalyst\)/);
      assert.match(combined, /Windows \(falhou\)/);
    });
  });
});
