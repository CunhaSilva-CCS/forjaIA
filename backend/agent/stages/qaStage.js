async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const qa = require('../qa');
  orchestrator.broadcast('agent-active', { agent: 'qa' });
  orchestrator.log('qa', 'Gerando e executando suíte de testes...', 'info');
  const testReport = await qa.execute(orchestrator.currentTask.files, runConfig, orchestrator);
  orchestrator.lastTestReport = testReport;
  orchestrator.currentTask.tests = testReport.tests;
  orchestrator.persistTask({ tests: orchestrator.currentTask.tests });
  orchestrator.broadcast('agent-finished', {
    agent: 'qa',
    status: testReport.passed ? 'success' : 'failed',
    data: testReport
  });
  await orchestrator.pauseForApproval(
    'security',
    `QA finalizado (${testReport.tests?.filter((t) => t.passed).length || 0}/${testReport.tests?.length || 0} ok). Aprove para rodar Segurança.`
  );
}

module.exports = { run };
