async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const debuggerAgent = require('../debugger');
  orchestrator.broadcast('agent-active', { agent: 'debugger' });
  orchestrator.log('debugger', 'Depurador Sênior analisando falhas e correlacionando evidências...', 'info');

  const diagnosis = await debuggerAgent.execute(
    orchestrator.currentTask.files,
    orchestrator.lastTestReport || { tests: orchestrator.currentTask.tests, passed: false },
    orchestrator.lastSecurityReport || { issues: orchestrator.currentTask.securityIssues, passed: false },
    runConfig,
    orchestrator
  );

  orchestrator.lastDiagnosis = diagnosis;
  orchestrator.currentTask.diagnosis = diagnosis;
  orchestrator.savedConfig = { ...orchestrator.savedConfig, lastDiagnosis: diagnosis };
  orchestrator.persistTask({});
  const { runs } = require('../../lib/db');
  runs.update(orchestrator.currentTask.id, { config: orchestrator.savedConfig });
  orchestrator.broadcast('agent-finished', { agent: 'debugger', status: 'success', data: diagnosis });
  orchestrator.broadcast('diagnosis-updated', diagnosis);

  await orchestrator.pauseForApproval(
    'healer',
    `Diagnóstico pronto (${diagnosis.severity}). Aprove o Curador para aplicar as correções.`
  );
}

module.exports = { run };
