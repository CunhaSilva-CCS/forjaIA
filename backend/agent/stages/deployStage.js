async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const devops = require('../devops');
  orchestrator.broadcast('agent-active', { agent: 'devops' });
  orchestrator.log('devops', 'Preparando deploy local final...', 'info');
  const deployResult = await devops.deploy(orchestrator.currentTask.files, runConfig, orchestrator);
  orchestrator.throwIfAborted();
  orchestrator.currentTask.deployUrl = deployResult.url;
  orchestrator.persistTask({ deployUrl: deployResult.url });
  const where = deployResult.url || `Simulador (${deployResult.simulatorName || 'iPhone'})`;
  orchestrator.log('orchestrator', `Projeto implantado em ${where}`, 'success');
  orchestrator.broadcast('agent-finished', { agent: 'devops', status: 'success', data: deployResult });
  await orchestrator.pauseForApproval(
    'human',
    `Deploy em ${where}. Aprove o teste humano in loco (fluxo e funcionamento).`
  );
}

module.exports = { run };
