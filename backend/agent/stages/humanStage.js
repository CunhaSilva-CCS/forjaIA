async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const human = require('../human');
  orchestrator.broadcast('agent-active', { agent: 'human' });
  orchestrator.log('human', 'Iniciando teste humano in loco no deploy…', 'info');

  const humanReport = await human.execute(
    orchestrator.currentTask.deployUrl,
    orchestrator.currentTask.files,
    runConfig,
    orchestrator
  );
  orchestrator.throwIfAborted();

  orchestrator.currentTask.humanReport = humanReport;
  orchestrator.savedConfig = {
    ...orchestrator.savedConfig,
    humanReport,
    lastHumanReport: humanReport
  };
  orchestrator.persistTask({
    config: orchestrator.savedConfig
  });
  orchestrator.broadcast('agent-finished', {
    agent: 'human',
    status: humanReport.passed ? 'success' : 'failed',
    data: humanReport
  });

  if (humanReport.passed) {
    await orchestrator.pauseForApproval(
      'prodReady',
      'Teste humano in loco aprovado. Aprove o checklist de produção (artefatos + gates finais).'
    );
    return;
  }

  const n = Array.isArray(humanReport.issues) ? humanReport.issues.length : 0;
  await orchestrator.pauseForApproval(
    'userFix',
    `Humano in loco encontrou ${n} problema(s) no fluxo. Aprove o Corretor do Usuário (ou envie um relato próprio).`
  );
}

module.exports = { run };
