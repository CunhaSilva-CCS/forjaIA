async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const { announceThinking } = require('../../lib/seniorEngineer');
  const devops = require('../devops');
  orchestrator.broadcast('agent-active', { agent: 'devops' });
  announceThinking(orchestrator, 'devops');
  orchestrator.log('devops', 'Preparando sandbox para testes de carga e caos...', 'info');

  const sandboxConfig = await devops.prepareSandbox(orchestrator.currentTask.files, runConfig, orchestrator);
  orchestrator.log('devops', 'Iniciando teste de carga com injeção de falhas no cliente (caos)...', 'warning');
  const loadTester = require('../../sandbox/load_tester');
  const chaos = require('../../sandbox/chaos');

  chaos.start(orchestrator);
  const metrics = await loadTester.run(sandboxConfig, orchestrator, orchestrator.currentTask.files);
  chaos.stop(orchestrator);

  orchestrator.currentTask.performanceMetrics = metrics;
  orchestrator.persistTask({ performanceMetrics: metrics });
  orchestrator.log(
    'devops',
    `Carga+caos finalizados. Requisições=${metrics.totalRequests}, latência média=${metrics.avgLatency}ms, sucesso=${metrics.successRate}%`,
    'success'
  );
  orchestrator.broadcast('metrics-updated', metrics);
  orchestrator.broadcast('agent-finished', { agent: 'devops', status: 'success', data: { metrics } });

  await devops.cleanupSandbox(sandboxConfig, orchestrator);
  await orchestrator.pauseForApproval(
    'deploy',
    `Carga/caos ok (sucesso ${metrics.successRate}%). Aprove para o deploy local.`
  );
}

module.exports = { run };
