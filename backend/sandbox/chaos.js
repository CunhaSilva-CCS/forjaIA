let latencyModifier = 0;
let packetLossRate = 0.0;
let intervalId = null;

const CHAOS_SCENARIOS = [
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
    loss: 0.20,
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

module.exports = {
  start: (orchestrator) => {
    // Resetar valores iniciais
    latencyModifier = 0;
    packetLossRate = 0.0;
    
    orchestrator.log(
      'devops',
      'Injeção de falhas de caos no cliente ATIVA (latência/perda de pacotes no cliente de carga, não na rede Docker).',
      'warning'
    );

    let scenarioIndex = 0;
    
    // Altera o cenário de caos a cada 800ms durante o teste de carga
    intervalId = setInterval(() => {
      scenarioIndex = (scenarioIndex + 1) % CHAOS_SCENARIOS.length;
      const scenario = CHAOS_SCENARIOS[scenarioIndex];
      
      latencyModifier = scenario.latency;
      packetLossRate = scenario.loss;
      
      orchestrator.log('devops', `[CHAOS EVENT] 💥 ${scenario.name}: ${scenario.log}`, scenario.type);
      orchestrator.broadcast('chaos-injected', {
        name: scenario.name,
        latency: scenario.latency,
        loss: scenario.loss,
        log: scenario.log
      });
    }, 800);
  },

  stop: (orchestrator) => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    latencyModifier = 0;
    packetLossRate = 0.0;
    orchestrator.log('devops', 'Engenharia do Caos finalizada. Limpando Sandbox.', 'info');
  },

  getLatencyModifier: () => latencyModifier,
  shouldDropPacket: () => Math.random() < packetLossRate
};
