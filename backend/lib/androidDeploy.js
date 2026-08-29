/**
 * "Deploy" Android via emulador (ver ADR-031) — mesmo espírito do Simulador de iPhone
 * (mobileDeploy.js, ADR-014): compila e instala o app num emulador Android já configurado
 * (Android Studio/avdmanager), visível na tela. Tentado sempre que um projeto mobile-expo é
 * implantado, ao lado do Simulador iOS — os dois fazem parte do par padrão que qualquer projeto
 * Expo/React Native alvo por padrão (`expo run:ios`/`expo run:android`), diferente de Mac Catalyst
 * e Windows (ADR-018), que exigem scaffolding extra opcional.
 */
const fs = require('fs');
const path = require('path');
const { execAsync } = require('./dockerBuild');
const { runExpoRun } = require('./expoRunProcess');

const BOOT_WAIT_MS = Number(process.env.FORJA_ANDROID_BOOT_WAIT_MS || 180000);
const DEVICE_APPEAR_WAIT_MS = Number(process.env.FORJA_ANDROID_DEVICE_WAIT_MS || 120000);
const POLL_MS = Number(process.env.FORJA_ANDROID_POLL_MS || 3000);

// `execAsync` roda com shell:true (ver dockerBuild.js) — todo chamador novo precisa sanitizar
// dado externo antes de interpolar na string de comando (mesmo raciocínio de SAFE_XCODE_NAME em
// mobileDeploy.js). Serial de dispositivo (`emulator-5554`, ou `IP:porta` pra device via rede) e
// nome de AVD (letras/números/`_`/`-`/`.`/`:`, regra do próprio Android) nunca legitimamente
// precisam de aspas/backtick/`$(`/`;` — qualquer coisa fora disso é rejeitada, não escapada.
const SAFE_ANDROID_ID = /^[\w.:-]+$/;

async function listAdbDevices() {
  const { stdout } = await execAsync('adb devices').catch(() => ({ stdout: '' }));
  return stdout
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter(([, state]) => state === 'device'); // exclui "offline"/"unauthorized"
}

/** Prefere um emulador (`emulator-*`) já rodando; senão pega o primeiro AVD configurado (Android
 * Studio/avdmanager) pra bootar. Não tenta criar um AVD do zero — igual ao Windows (ADR-018), é
 * configuração de ambiente do usuário, não uma etapa repetível de pipeline. */
async function pickAndroidEmulator() {
  const devices = await listAdbDevices();
  const runningEmulator = devices.find(([serial]) => serial.startsWith('emulator-'));
  if (runningEmulator) return { serial: runningEmulator[0], name: null, alreadyRunning: true };

  const { stdout } = await execAsync('emulator -list-avds').catch(() => {
    throw new Error('Comando "emulator" não encontrado — verifique se o Android SDK está instalado e no PATH.');
  });
  const avds = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!avds.length) {
    throw new Error('Nenhum emulador Android disponível (crie um AVD no Android Studio ou via avdmanager).');
  }
  return { serial: null, name: avds[0], alreadyRunning: false };
}

/** Boota o AVD em background (o processo do emulador nunca termina sozinho — mesmo padrão do
 * Simulador de iPhone) e espera aparecer no `adb devices`, depois espera o boot terminar de
 * verdade via `sys.boot_completed` — sem isso, `expo run:android` tenta instalar num device que
 * ainda não processa intents, e a instalação falha ou trava esperando o launcher. */
async function ensureAndroidBooted(sim) {
  let serial = sim.serial;
  if (!sim.alreadyRunning) {
    const { spawn } = require('child_process');
    const child = spawn('emulator', ['-avd', sim.name, '-no-audio', '-no-boot-anim'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    const start = Date.now();
    while (!serial && Date.now() - start < DEVICE_APPEAR_WAIT_MS) {
      const devices = await listAdbDevices();
      const found = devices.find(([s]) => s.startsWith('emulator-'));
      if (found) serial = found[0];
      else await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (!serial) {
      throw new Error(`Emulador Android (${sim.name}) não apareceu no "adb devices" em ${DEVICE_APPEAR_WAIT_MS / 1000}s.`);
    }
  }

  if (!SAFE_ANDROID_ID.test(serial)) {
    throw new Error(`Serial de dispositivo Android com formato inesperado, recusando interpolar em comando: ${serial}`);
  }

  const start = Date.now();
  while (Date.now() - start < BOOT_WAIT_MS) {
    try {
      const { stdout } = await execAsync(`adb -s ${serial} shell getprop sys.boot_completed`);
      if (stdout.trim() === '1') return serial;
    } catch {
      // dispositivo ainda não responde shell — normal durante o boot
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Emulador Android (${serial}) não terminou de bootar em ${BOOT_WAIT_MS / 60000} minutos.`);
}

/**
 * O applicationId "de verdade" (o que acabou instalado no emulador) vem do projeto nativo gerado
 * pelo prebuild do `expo run:android` (android/app/build.gradle), mesmo raciocínio de
 * resolveBundleId no lado iOS — cai pro app.json só se o build.gradle não existir ainda.
 */
function resolveAndroidPackage(projectDir) {
  try {
    const gradlePath = path.join(projectDir, 'android', 'app', 'build.gradle');
    if (fs.existsSync(gradlePath)) {
      const content = fs.readFileSync(gradlePath, 'utf8');
      const match = content.match(/applicationId\s+['"]([^'"]+)['"]/);
      if (match) return match[1];
    }
  } catch {
    // cai pro app.json abaixo
  }
  try {
    const appJsonPath = fs.existsSync(path.join(projectDir, 'app.json'))
      ? path.join(projectDir, 'app.json')
      : path.join(projectDir, 'app.config.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    return appJson?.expo?.android?.package || null;
  } catch {
    return null;
  }
}

async function deployToAndroidEmulator({ projectDir, orchestrator }) {
  const sim = await pickAndroidEmulator();
  orchestrator.log('devops', `Emulador Android escolhido: ${sim.name || sim.serial}.`, 'info');
  const serial = await ensureAndroidBooted(sim);
  orchestrator.log(
    'devops',
    'Compilando e instalando no emulador Android (expo run:android) — pode levar alguns minutos na primeira vez...',
    'info'
  );

  await runExpoRun(['expo', 'run:android'], projectDir, {
    signal: orchestrator.getSignal?.(),
    label: 'expo run:android'
  });

  orchestrator.log('devops', `App instalado e aberto no emulador Android (${serial}).`, 'success');
  return {
    type: 'android-emulator',
    url: null,
    emulatorSerial: serial,
    androidPackage: resolveAndroidPackage(projectDir)
  };
}

module.exports = {
  deployToAndroidEmulator,
  pickAndroidEmulator,
  resolveAndroidPackage,
  listAdbDevices,
  __test__: { ensureAndroidBooted }
};
