const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');
const childProcess = require('child_process');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-android-${Date.now()}.db`);
process.env.FORJA_ANDROID_DEVICE_WAIT_MS = '500';
process.env.FORJA_ANDROID_BOOT_WAIT_MS = '500';
process.env.FORJA_ANDROID_POLL_MS = '5';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

/** Mesmo padrão de windowsDeploy.test.js — execAsync (dockerBuild.js) roda via
 * spawn(cmd, {shell:true}), então mockar child_process.spawn cobre tanto execAsync quanto
 * chamadas diretas a spawn (o boot do emulador usa spawn com array de args, não shell).
 *
 * dockerBuild.js destrutura `spawn` de child_process no topo do módulo — precisa ser fresh()-ado
 * DEPOIS do mock aplicado aqui e ANTES de qualquer módulo que use execAsync (androidDeploy.js),
 * senão a referência cacheada continua apontando pro spawn real (mesmo achado já corrigido em
 * mobileDeploy.test.js). Por isso este helper já faz o fresh, pra nenhum teste esquecer. */
function mockSpawnSequence(responses) {
  let call = 0;
  childProcess.spawn = (...args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.unref = () => {};
    child.pid = 12345;
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    process.nextTick(() => {
      if (response.stdout) child.stdout.emit('data', Buffer.from(response.stdout));
      if (response.close !== false) child.emit('close', response.code ?? 0);
    });
    return child;
  };
  fresh('../lib/dockerBuild');
  return () => call;
}

describe('androidDeploy.resolveAndroidPackage (ADR-031)', () => {
  it('prioriza applicationId do build.gradle gerado pelo prebuild sobre o app.json', () => {
    const { resolveAndroidPackage } = fresh('../lib/androidDeploy');
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-android-pkg-gradle-'));
    fs.writeFileSync(path.join(projectDir, 'app.json'), JSON.stringify({ expo: { android: { package: 'com.appjson.velho' } } }));
    const appDir = path.join(projectDir, 'android', 'app');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, 'build.gradle'),
      "android {\n    defaultConfig {\n        applicationId 'com.forja.demo.real'\n    }\n}\n"
    );
    assert.equal(resolveAndroidPackage(projectDir), 'com.forja.demo.real');
  });

  it('cai pro app.json quando não há build.gradle (prebuild ainda não rodou)', () => {
    const { resolveAndroidPackage } = fresh('../lib/androidDeploy');
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-android-pkg-appjson-'));
    fs.writeFileSync(path.join(projectDir, 'app.json'), JSON.stringify({ expo: { android: { package: 'com.forja.fallback' } } }));
    assert.equal(resolveAndroidPackage(projectDir), 'com.forja.fallback');
  });

  it('retorna null sem quebrar quando não há build.gradle nem app.json com package', () => {
    const { resolveAndroidPackage } = fresh('../lib/androidDeploy');
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-android-pkg-nada-'));
    assert.equal(resolveAndroidPackage(projectDir), null);
  });
});

describe('androidDeploy.pickAndroidEmulator (ADR-031)', () => {
  const originalSpawn = childProcess.spawn;

  it('prefere um emulador já rodando (adb devices) em vez de listar AVDs', async () => {
    mockSpawnSequence([{ stdout: 'List of devices attached\nemulator-5554\tdevice\n', code: 0 }]);
    try {
      const { pickAndroidEmulator } = fresh('../lib/androidDeploy');
      const sim = await pickAndroidEmulator();
      assert.equal(sim.serial, 'emulator-5554');
      assert.equal(sim.alreadyRunning, true);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('sem emulador rodando, pega o primeiro AVD configurado', async () => {
    mockSpawnSequence([
      { stdout: 'List of devices attached\n', code: 0 }, // adb devices — vazio
      { stdout: 'Medium_Phone_API_36.1\nPixel_8_Pro\n', code: 0 } // emulator -list-avds
    ]);
    try {
      const { pickAndroidEmulator } = fresh('../lib/androidDeploy');
      const sim = await pickAndroidEmulator();
      assert.equal(sim.name, 'Medium_Phone_API_36.1');
      assert.equal(sim.alreadyRunning, false);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('rejeita com mensagem clara quando não há emulador rodando nem AVD configurado', async () => {
    mockSpawnSequence([
      { stdout: 'List of devices attached\n', code: 0 },
      { stdout: '', code: 0 }
    ]);
    try {
      const { pickAndroidEmulator } = fresh('../lib/androidDeploy');
      await assert.rejects(pickAndroidEmulator(), /Nenhum emulador Android disponível/);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('ignora dispositivo offline/unauthorized — só considera "device" pronto', async () => {
    mockSpawnSequence([
      { stdout: 'List of devices attached\nemulator-5554\toffline\nemulator-5556\tdevice\n', code: 0 }
    ]);
    try {
      const { pickAndroidEmulator } = fresh('../lib/androidDeploy');
      const sim = await pickAndroidEmulator();
      assert.equal(sim.serial, 'emulator-5556');
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });
});

describe('androidDeploy.ensureAndroidBooted — validação de serial antes de interpolar em shell (achado real, mesma disciplina do SAFE_XCODE_NAME)', () => {
  const originalSpawn = childProcess.spawn;

  it('recusa um serial com formato inesperado em vez de interpolar no comando adb', async () => {
    try {
      const { __test__ } = fresh('../lib/androidDeploy');
      await assert.rejects(
        __test__.ensureAndroidBooted({ serial: 'emulator-5554; rm -rf /', alreadyRunning: true }),
        /formato inesperado/
      );
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('achado real: espera sys.boot_completed=1 antes de considerar o emulador pronto', async () => {
    mockSpawnSequence([
      { stdout: '0\n', code: 0 }, // getprop sys.boot_completed — ainda bootando
      { stdout: '1\n', code: 0 } // getprop sys.boot_completed — pronto
    ]);
    try {
      const { __test__ } = fresh('../lib/androidDeploy');
      const serial = await __test__.ensureAndroidBooted({ serial: 'emulator-5554', alreadyRunning: true });
      assert.equal(serial, 'emulator-5554');
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });
});

describe('androidDeploy.deployToAndroidEmulator — fim a fim (só spawn/expo run mockados, o resto é código real)', () => {
  const originalSpawn = childProcess.spawn;

  it('achado real: escolhe o emulador já rodando, confirma o boot e chama expo run:android', async () => {
    mockSpawnSequence([
      { stdout: 'List of devices attached\nemulator-5554\tdevice\n', code: 0 }, // pickAndroidEmulator: adb devices
      { stdout: '1\n', code: 0 } // ensureAndroidBooted: getprop sys.boot_completed (já pronto)
    ]);
    // expoRunProcess.js destrutura `spawn` no topo — precisa ser fresh()-ado DEPOIS do mock acima
    // e ANTES de androidDeploy.js, senão a referência cacheada aponta pro spawn real (mesmo achado
    // já corrigido em mobileDeploy.test.js).
    const expoRunProcess = fresh('../lib/expoRunProcess');
    let runArgs = null;
    expoRunProcess.runExpoRun = async (args, projectDir) => {
      runArgs = { args, projectDir };
      return { logPath: '/tmp/x.log' };
    };
    try {
      const androidDeploy = fresh('../lib/androidDeploy');
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-android-e2e-'));
      const logs = [];
      const orchestrator = { log: (agent, msg, type) => logs.push({ msg, type }), getSignal: () => undefined };

      const result = await androidDeploy.deployToAndroidEmulator({ projectDir, orchestrator });

      assert.deepEqual(runArgs.args, ['expo', 'run:android']);
      assert.equal(runArgs.projectDir, projectDir);
      assert.equal(result.type, 'android-emulator');
      assert.equal(result.emulatorSerial, 'emulator-5554');
      assert.ok(logs.some((l) => /App instalado e aberto no emulador Android/.test(l.msg) && l.type === 'success'));
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });
});
