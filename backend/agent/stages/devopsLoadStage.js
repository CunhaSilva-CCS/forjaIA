async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const { announceThinking } = require('../../lib/seniorEngineer');
  const devops = require('../devops');
  orchestrator.broadcast('agent-active', { agent: 'devops' });
  announceThinking(orchestrator, 'devops');

  // Carga/caos pressupõe um servidor HTTP na sandbox Docker — não se aplica a um app mobile
  // nativo (ver ADR-014). Pula direto pro deploy no Simulador.
  const { detectProjectType } = require('../../lib/projectType');
  if (detectProjectType(orchestrator.currentTask.files) === 'mobile-expo') {
    orchestrator.log('devops', 'Projeto mobile — sem servidor HTTP pra testar carga/caos; pulando para o deploy.', 'info');
    orchestrator.broadcast('agent-finished', { agent: 'devops', status: 'success', data: { skipped: true } });
    await orchestrator.pauseForApproval('deploy', 'Projeto mobile: carga/caos não se aplica. Aprove para o deploy no Simulador.');
    return;
  }

  orchestrator.log('devops', 'Preparando sandbox para testes de carga e caos...', 'info');

  const sandboxConfig = await devops.prepareSandbox(orchestrator.currentTask.files, runConfig, orchestrator);
  orchestrator.log('devops', 'Iniciando teste de carga com engenharia do caos...', 'warning');
  const loadTester = require('../../sandbox/load_tester');
  const chaos = require('../../sandbox/chaos');

  chaos.start(orchestrator, sandboxConfig);
  const metrics = await loadTester.run(sandboxConfig, orchestrator, orchestrator.currentTask.files);
  await chaos.stop(orchestrator, sandboxConfig);

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
