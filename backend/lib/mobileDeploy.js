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

module.exports = {
  deployToSimulator,
  pickSimulator,
  __test__: { runExpoRunIos }
};
