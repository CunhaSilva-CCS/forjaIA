const dockerChaos = require('./dockerChaos');

/** Cenários usados quando NÃO há container Docker real disponível (fallback simulado). */
const SIM_SCENARIOS = [
  {
    name: 'Normalização da Rede',
    latency: 0,
    loss: 0.0,
    log: 'Status da infraestrutura estabilizado. Rede operando normalmente.',
    type: 'success'
  },
  {
    name: 'Latência de Banco de Dados',
    latency: 250,
    loss: 0.0,
    log: 'Injetando gargalo de latência: simulação de overload no Pool de Conexões (+250ms).',
    type: 'warning'
  },
  {
    name: 'Perda de Pacotes (Jitter/Filtro de Rede)',
    latency: 50,
    loss: 0.2,
    log: 'Injetando perda de pacotes: simulação de instabilidade no gateway de rede (20% packet drop).',
    type: 'warning'
  },
  {
    name: 'CPU Throttling no Container',
    latency: 500,
    loss: 0.05,
    log: 'Injetando CPU Throttling: limitando capacidade de processamento do Node Event Loop (+500ms, 5% drop).',
    type: 'warning'
  }
];

// period fixo de 100ms; quota em µs. 200000/100000 = 2 CPUs, igual ao NanoCpus:2e9 da criação da sandbox.
const REAL_CPU_PERIOD = 100000;
const REAL_CPU_FULL_QUOTA = 200000;
const REAL_CPU_THROTTLED_QUOTA = 20000; // ~0.2 vCPU

/** Cenários reais: cada um é uma operação de verdade contra o container via API do Docker. */
const REAL_SCENARIOS = [
  {
    name: 'Latência de Banco de Dados',
    kind: 'netem',
    delayMs: 250,
    lossPercent: 0,
    log: 'tc netem real na interface do container: +250ms de latência.',
    type: 'warning',
    dwellMs: 900
  },
  {
    name: 'Perda de Pacotes (Jitter/Filtro de Rede)',
    kind: 'netem',
    delayMs: 50,
    lossPercent: 20,
    log: 'tc netem real na interface do container: +50ms e 20% de perda de pacotes.',
    type: 'warning',
    dwellMs: 900
  },
  {
    name: 'CPU Throttling no Container',
    kind: 'cpu',
    quotaMicros: REAL_CPU_THROTTLED_QUOTA,
    log: 'Cota de CPU real do container reduzida para ~0.2 vCPU (container.update).',
    type: 'warning',
    dwellMs: 900
  },
  {
    name: 'Normalização da Rede/CPU',
    kind: 'clear',
    log: 'Faults reais removidos: rede e CPU do container normalizados.',
    type: 'success',
    dwellMs: 400
  }
];

let latencyModifier = 0;
let packetLossRate = 0.0;
let intervalId = null;
let realLoopActive = false;
let realLoopTimer = null;
let currentMode = 'client-side-fault-injection';

/** setTimeout cancelável — evita segurar o event loop vivo depois de stop(). */
function sleepCancelable(ms) {
  return new Promise((resolve) => {
    realLoopTimer = setTimeout(() => {
      realLoopTimer = null;
      resolve();
    }, ms);
  });
}

async function applyRealScenario(docker, containerId, scenario) {
  if (scenario.kind === 'netem') {
    await dockerChaos.injectNetworkFault({
      docker,
      containerId,
      delayMs: scenario.delayMs,
      lossPercent: scenario.lossPercent
    });
  } else if (scenario.kind === 'cpu') {
    await dockerChaos.throttleCpu({
      docker,
      containerId,
      quotaMicros: scenario.quotaMicros,
      periodMicros: REAL_CPU_PERIOD
    });
  } else if (scenario.kind === 'clear') {
    await dockerChaos.clearNetworkFault({ docker, containerId });
    await dockerChaos.resetCpu({
      docker,
      containerId,
      quotaMicros: REAL_CPU_FULL_QUOTA,
      periodMicros: REAL_CPU_PERIOD
    });
  }
}

function startClientSimulation(orchestrator) {
  let scenarioIndex = 0;
  intervalId = setInterval(() => {
    scenarioIndex = (scenarioIndex + 1) % SIM_SCENARIOS.length;
    const scenario = SIM_SCENARIOS[scenarioIndex];
    latencyModifier = scenario.latency;
    packetLossRate = scenario.loss;
    orchestrator.log('devops', `[CHAOS SIMULADO] 💥 ${scenario.name}: ${scenario.log}`, scenario.type);
    orchestrator.broadcast('chaos-injected', {
      name: scenario.name,
      latency: scenario.latency,
      loss: scenario.loss,
      log: scenario.log,
      real: false
    });
  }, 800);
}

/** Cicla pelos cenários reais até stop() derrubar a flag. Nunca lança — se uma operação
 * real falhar, cai para a simulação client-side e registra o motivo. */
async function runRealLoop(orchestrator, docker, containerId) {
  realLoopActive = true;
  let i = 0;
  while (realLoopActive) {
    const scenario = REAL_SCENARIOS[i % REAL_SCENARIOS.length];
    i += 1;
    try {
      await applyRealScenario(docker, containerId, scenario);
    } catch (err) {
      orchestrator.log(
        'devops',
        `Chaos real falhou (${err.message}); revertendo para simulação no cliente.`,
        'warning'
      );
      realLoopActive = false;
      currentMode = 'client-side-fault-injection';
      startClientSimulation(orchestrator);
      return;
    }
    orchestrator.log('devops', `[CHAOS REAL] 💥 ${scenario.name}: ${scenario.log}`, scenario.type);
    orchestrator.broadcast('chaos-injected', { name: scenario.name, log: scenario.log, real: true });
    if (!realLoopActive) break;
    await sleepCancelable(scenario.dwellMs || 800);
  }
}

module.exports = {
  /**
   * @param {object} orchestrator
   * @param {object|null} sandboxConfig - retorno de sandbox/runner.js#start(); quando é uma
   *   sandbox Docker real, o chaos passa a agir de verdade sobre o container (tc netem +
   *   cota de CPU). Sem isso (ou Docker indisponível), cai na simulação client-side de sempre.
   */
  start: (orchestrator, sandboxConfig = null) => {
    latencyModifier = 0;
    packetLossRate = 0.0;
    realLoopActive = false;

    if (dockerChaos.isAvailable(sandboxConfig)) {
      currentMode = 'docker-fault-injection';
      orchestrator.log(
        'devops',
        'Engenharia do Caos REAL ativa: tc netem + cota de CPU no container da sandbox (não é simulação).',
        'warning'
      );
      const { docker } = sandboxConfig.runner;
      const { containerId } = sandboxConfig;
      runRealLoop(orchestrator, docker, containerId).catch((err) => {
        orchestrator.log('devops', `Loop de chaos real encerrou com erro (${err.message}).`, 'warning');
      });
      return;
    }

    currentMode = 'client-side-fault-injection';
    orchestrator.log(
      'devops',
      'Sandbox sem container Docker disponível; usando simulação de falhas no cliente (não é chaos real).',
      'warning'
    );
    startClientSimulation(orchestrator);
  },

  stop: async (orchestrator, sandboxConfig = null) => {
    realLoopActive = false;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (realLoopTimer) {
      clearTimeout(realLoopTimer);
      realLoopTimer = null;
    }
    latencyModifier = 0;
    packetLossRate = 0.0;

    if (dockerChaos.isAvailable(sandboxConfig)) {
      const { docker } = sandboxConfig.runner;
      const { containerId } = sandboxConfig;
      try {
        await dockerChaos.clearNetworkFault({ docker, containerId });
      } catch {
        // best-effort — a sandbox costuma ser destruída logo em seguida de qualquer forma
      }
      try {
        await dockerChaos.resetCpu({
          docker,
          containerId,
          quotaMicros: REAL_CPU_FULL_QUOTA,
          periodMicros: REAL_CPU_PERIOD
        });
      } catch {
        // best-effort
      }
    }

    orchestrator.log('devops', 'Engenharia do Caos finalizada. Limpando Sandbox.', 'info');
  },

  getLatencyModifier: () => latencyModifier,
  shouldDropPacket: () => Math.random() < packetLossRate,
  getMode: () => currentMode
};
