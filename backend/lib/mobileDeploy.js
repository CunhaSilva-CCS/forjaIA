/**
 * "Deploy" para projetos mobile Expo/React Native (ver ADR-014): não existe container/porta HTTP
 * — o equivalente real é compilar e instalar o app num Simulador de iPhone, visível na tela.
 * Reaproveita o mesmo shape de resultado de lib/deployRuntime.js (`{ type, url, ... }`) com
 * `url: null` — devopsStage/reportStage/humanStage tratam a ausência de URL como sinal pra pular
 * a parte que pressupõe HTTP.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { execAsync } = require('./dockerBuild');

async function pickSimulator() {
  const { stdout } = await execAsync('xcrun simctl list devices available -j');
  const data = JSON.parse(stdout);
  const allDevices = Object.values(data.devices).flat();
  const iphones = allDevices.filter((d) => d.isAvailable && /iPhone/.test(d.name));
  if (!iphones.length) {
    throw new Error('Nenhum Simulador de iPhone disponível (verifique o Xcode/Simulator instalado)');
  }
  return iphones.find((d) => d.state === 'Booted') || iphones[0];
}

async function ensureBooted(sim) {
  if (sim.state !== 'Booted') {
    await execAsync(`xcrun simctl boot ${sim.udid}`);
  }
  await execAsync('open -a Simulator');
}

const SUCCESS_MARKERS = [/Opening (on|exp:)/i, /Installed on/i, /Logs for your project/i, /Press [a-z] /i];
const QUIET_PERIOD_MS = 45000;
const POLL_INTERVAL_MS = 2000;
const HARD_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Diferente de um build Docker (que termina e o processo sai), `expo run:ios` fica rodando pra
 * sempre depois de compilar/instalar/abrir o app — vira o servidor Metro (bundler), do mesmo jeito
 * que `expo start` fica. O app em build de debug carrega o JS DESSE servidor em runtime, então
 * matar o processo depois do "sucesso" quebraria o app na tela.
 *
 * "Sucesso" aqui não é o processo fechar (nunca fecha sozinho) — é: uma frase conhecida de sucesso
 * aparecer no log, OU (mais robusto, não depende de adivinhar o texto exato de uma versão do Expo)
 * um período sem nenhuma saída nova depois de já ter passado pela fase ruidosa de compilação.
 *
 * stdio vai pra um ARQUIVO (não pra um pipe do processo pai) e o filho roda `detached: true` —
 * assim ele fica genuinamente independente do processo do ForjaIA. Um pipe ligado ao pai quebra
 * quando o pai sai (o servidor do ForjaIA é reiniciado com frequência durante desenvolvimento) e
 * derruba o Metro junto, mesmo com detached+unref — só stdio própria garante isso.
 */
function runExpoRunIos(projectDir, udid, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const logPath = path.join(os.tmpdir(), `forja-expo-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
    const logFd = fs.openSync(logPath, 'a');
    const child = spawn('npx', ['expo', 'run:ios', '--device', udid], {
      cwd: projectDir,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });
    fs.closeSync(logFd); // o filho já tem seu próprio descritor; fechar o nosso não afeta ele

    let settled = false;
    let onAbort;
    let pollTimer = null;
    let lastSize = 0;
    let lastChangeAt = Date.now();

    const cleanup = () => {
      clearInterval(pollTimer);
      clearTimeout(hardTimeout);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    };

    const finish = (fn, arg, { kill = false } = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (kill) {
        // detached:true faz do filho o líder de um novo grupo de processos — matar só o PID dele
        // deixaria o xcodebuild (neto) órfão e ainda rodando. PID negativo mata o grupo inteiro.
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            // já pode ter morrido
          }
        }
      } else {
        child.unref();
      }
      fn(arg);
    };

    const hardTimeout = setTimeout(() => {
      finish(reject, new Error(`expo run:ios não sinalizou conclusão em ${HARD_TIMEOUT_MS / 60000} minutos`), { kill: true });
    }, HARD_TIMEOUT_MS);

    if (signal) {
      if (signal.aborted) {
        finish(reject, new Error('Abortado'), { kill: true });
        return;
      }
      onAbort = () => finish(reject, new Error('Abortado'), { kill: true });
      signal.addEventListener('abort', onAbort, { once: true });
    }

    pollTimer = setInterval(() => {
      let stat;
      try {
        stat = fs.statSync(logPath);
      } catch {
        return;
      }
      if (stat.size !== lastSize) {
        lastSize = stat.size;
        lastChangeAt = Date.now();
        const content = fs.readFileSync(logPath, 'utf8');
        if (SUCCESS_MARKERS.some((re) => re.test(content))) {
          finish(resolve, { logPath });
        }
        return;
      }
      if (stat.size > 0 && Date.now() - lastChangeAt > QUIET_PERIOD_MS) {
        finish(resolve, { logPath });
      }
    }, POLL_INTERVAL_MS);

    child.on('error', (err) => finish(reject, err, { kill: false }));
    child.on('exit', (code) => {
      if (code === 0 || code === null) {
        // Saiu sozinho com sucesso, ou foi encerrado externamente sem sinalizar erro.
        finish(resolve, { logPath });
        return;
      }
      const err = new Error(`expo run:ios saiu com código ${code}`);
      try {
        err.log = fs.readFileSync(logPath, 'utf8').slice(-4000);
      } catch {
        // sem log disponível
      }
      finish(reject, err, { kill: false });
    });
  });
}

async function deployToSimulator({ projectDir, orchestrator }) {
  const sim = await pickSimulator();
  orchestrator.log('devops', `Simulador escolhido: ${sim.name} (${sim.udid}).`, 'info');
  await ensureBooted(sim);
  orchestrator.log('devops', 'Compilando e instalando no Simulador (expo run:ios) — pode levar alguns minutos na primeira vez...', 'info');

  await runExpoRunIos(projectDir, sim.udid, { signal: orchestrator.getSignal?.() });

  orchestrator.log('devops', `App instalado e aberto no Simulador (${sim.name}).`, 'success');
  return {
    type: 'ios-simulator',
    url: null,
    simulatorName: sim.name,
    simulatorUdid: sim.udid
  };
}

// Nome de workspace/scheme "normal" de Xcode — letras, números, espaço, ponto, hífen, underscore,
// parênteses. Qualquer coisa fora disso (aspas, backtick, `$(`, `;`, etc.) é rejeitada.
const SAFE_XCODE_NAME = /^[\w .+()-]+$/;

/** Acha o .xcworkspace do projeto (convenção Expo/RN: nome do workspace == nome do scheme). */
function findXcodeWorkspace(projectDir) {
  const iosDir = path.join(projectDir, 'ios');
  if (!fs.existsSync(iosDir)) return null;
  const entry = fs.readdirSync(iosDir).find((f) => f.endsWith('.xcworkspace'));
  if (!entry) return null;
  const scheme = entry.replace(/\.xcworkspace$/, '');
  // `entry`/`scheme` acabam interpolados sem escape numa string de shell (`execAsync` roda com
  // `shell: true`) tanto aqui quanto em deployToMac/supportsMacCatalyst. O nome vem do sistema de
  // arquivos, mas quem decide o nome de um arquivo escrito pelo pipeline é o LLM (`agent/coder.js`
  // grava o `.xcworkspace` como qualquer outro arquivo gerado) — um nome como `Evil".xcworkspace`
  // quebraria as aspas duplas e injetaria comando arbitrário. Rejeita em vez de escapar: nomes de
  // workspace/scheme reais nunca precisam de aspas/backtick/`$(`/`;`.
  if (!SAFE_XCODE_NAME.test(entry) || !SAFE_XCODE_NAME.test(scheme)) return null;
  return { dir: iosDir, workspace: entry, scheme };
}

/**
 * macOS via Mac Catalyst DE VERDADE (ver ADR-018): reaproveita o MESMO projeto Xcode do iOS — "My
 * Mac" é só mais um destino de build (`-destination 'platform=macOS,name=My Mac'`), não precisa de
 * uma pasta nativa `macos/` separada como o react-native-macos exigiria.
 *
 * A checagem exige o variant `Mac Catalyst` explicitamente, não só "tem destino macOS" —
 * descoberto rodando contra um projeto real (secPass): quando o alvo NÃO tem
 * `SUPPORTS_MACCATALYST` habilitado, `xcodebuild -showdestinations` ainda lista um destino
 * `platform:macOS, name:My Mac`, mas com `variant:Designed for [iPad,iPhone]` — Apple Silicon
 * rodando o binário iOS original sem recompilar, não Catalyst. O build até compila (produz um
 * Mach-O `platform:iOS` de verdade, confirmado via `otool -l`), mas `open` no `.app` falha
 * ("incorrect executable format") e nem `xcrun devicectl` reconhece "My Mac" como device
 * instalável — não existe caminho de linha de comando conhecido pra lançar esse modo fora do
 * próprio Xcode. Por isso só o variant Catalyst real é aceito aqui; "Designed for iPad" é tratado
 * como não suportado (pula o alvo, mensagem clara, em vez de compilar um binário que não abre).
 */
async function supportsMacCatalyst(projectDir) {
  const ws = findXcodeWorkspace(projectDir);
  if (!ws) return false;
  try {
    const { stdout } = await execAsync(
      `xcodebuild -workspace "${ws.workspace}" -scheme "${ws.scheme}" -showdestinations`,
      { cwd: ws.dir }
    );
    return /platform:macOS/i.test(stdout) && /variant:\s*Mac Catalyst/i.test(stdout);
  } catch {
    return false;
  }
}

/**
 * Acha o .app compilado dentro do DerivedData pro destino "My Mac". A pasta de saída varia com o
 * MODO real usado pelo projeto — `Debug-maccatalyst/` pra Catalyst de verdade (SUPPORTS_MACCATALYST),
 * mas `Debug-iphoneos/` quando o projeto não tem Catalyst habilitado e o destino "My Mac" resolve
 * pra "Designed for iPad" (Apple Silicon rodando o binário iOS nativo sem recompilar) — descoberto
 * rodando contra um projeto real (secPass): o `xcodebuild` desse caso compila com
 * `-target-sdk-version` de iOS, não existe variant Catalyst separado. Por isso a busca é genérica:
 * qualquer pasta de config que não seja de Simulador.
 */
function findBuiltMacApp(derivedDataPath) {
  const productsDir = path.join(derivedDataPath, 'Build', 'Products');
  if (!fs.existsSync(productsDir)) return null;
  const configDirs = fs.readdirSync(productsDir).filter((d) => !/simulator/i.test(d));
  for (const dir of configDirs) {
    const full = path.join(productsDir, dir);
    const app = fs.readdirSync(full).find((f) => f.endsWith('.app'));
    if (app) return path.join(full, app);
  }
  return null;
}

/**
 * macOS via Mac Catalyst (ver ADR-018): `expo run:ios --device` NÃO suporta Catalyst — o CLI só
 * resolve simuladores/dispositivos iOS reais contra `-d/--device` (confirmado via `--help` e um
 * erro real: "No device UDID or name matching 'my mac'"); "My Mac" só existe no vocabulário do
 * `xcodebuild -showdestinations`, não no do Expo. Por isso este passo pula o Expo CLI inteiramente
 * e chama `xcodebuild` direto — build com assinatura ad-hoc (`CODE_SIGN_IDENTITY=-`, sem
 * signing obrigatório, igual ao que o Xcode faz pra "Sign to Run Locally") e depois `open` no
 * `.app` gerado no DerivedData.
 */
async function deployToMac({ projectDir, orchestrator }) {
  const ws = findXcodeWorkspace(projectDir);
  const supported = await supportsMacCatalyst(projectDir);
  if (!ws || !supported) {
    throw new Error(
      'Projeto sem Mac Catalyst habilitado no Xcode (SUPPORTS_MACCATALYST) — não é possível compilar pra macOS sem isso.'
    );
  }
  orchestrator.log('devops', 'Compilando para macOS via Mac Catalyst (xcodebuild) — pode levar alguns minutos...', 'info');

  const derivedDataPath = path.join(os.tmpdir(), `forja-catalyst-dd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const cmd = [
    'xcodebuild',
    `-workspace "${ws.workspace}"`,
    `-scheme "${ws.scheme}"`,
    `-destination "platform=macOS,name=My Mac"`,
    '-configuration Debug',
    `-derivedDataPath "${derivedDataPath}"`,
    'CODE_SIGN_IDENTITY=-',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGNING_ALLOWED=NO',
    'build'
  ].join(' ');

  try {
    await execAsync(cmd, { cwd: ws.dir });
  } catch (err) {
    const wrapped = new Error(`xcodebuild (Mac Catalyst) falhou: ${err.message}`);
    wrapped.log = String(`${err.stdout || ''}\n${err.stderr || ''}`).slice(-4000);
    throw wrapped;
  }

  const appPath = findBuiltMacApp(derivedDataPath);
  if (!appPath) {
    throw new Error(`Build do Catalyst terminou mas não achei o .app gerado em ${derivedDataPath}`);
  }
  await execAsync(`open "${appPath}"`);
  orchestrator.log('devops', `App instalado e aberto no Mac (Catalyst): ${appPath}`, 'success');
  return { type: 'mac-catalyst', url: null, appPath };
}

module.exports = {
  deployToSimulator,
  deployToMac,
  pickSimulator,
  supportsMacCatalyst,
  findXcodeWorkspace,
  findBuiltMacApp,
  __test__: { runExpoRunIos }
};
