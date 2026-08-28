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
  // persistTask() já grava `config: this.savedConfig` sempre (ver orchestrator.js), então o
  // runs.update(...) explícito que existia aqui era uma escrita duplicada byte-a-byte —
  // resquício de antes de persistTask incluir config incondicionalmente.
  orchestrator.persistTask({});
  orchestrator.broadcast('agent-finished', { agent: 'debugger', status: 'success', data: diagnosis });
  orchestrator.broadcast('diagnosis-updated', diagnosis);

  await orchestrator.pauseForApproval(
    'healer',
    `Diagnóstico pronto (${diagnosis.severity}). Aprove o Curador para aplicar as correções.`
  );
}

module.exports = { run };
