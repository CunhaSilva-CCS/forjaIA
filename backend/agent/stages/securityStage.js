async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  if (!orchestrator.lastTestReport && Array.isArray(orchestrator.currentTask?.tests)) {
    const tests = orchestrator.currentTask.tests;
    orchestrator.lastTestReport = {
      tests,
      passed: tests.length > 0 && tests.every((t) => t.passed)
    };
  }
  const security = require('../security');
  orchestrator.broadcast('agent-active', { agent: 'security' });
  orchestrator.log('security', 'Executando verificações estáticas e dinâmicas de segurança...', 'warning');
  const securityReport = await security.execute(orchestrator.currentTask.files, runConfig, orchestrator);
  orchestrator.lastSecurityReport = securityReport;
  orchestrator.currentTask.securityIssues = securityReport.issues;
  orchestrator.persistTask({ securityIssues: orchestrator.currentTask.securityIssues });
  orchestrator.broadcast('agent-finished', {
    agent: 'security',
    status: securityReport.passed ? 'success' : 'failed',
    data: securityReport
  });

  const needsHeal =
    (!orchestrator.lastTestReport?.passed || !securityReport.passed) &&
    orchestrator.healingAttempts < orchestrator.maxHealingAttempts;

  if (needsHeal) {
    await orchestrator.pauseForApproval(
      'debugger',
      'QA/Segurança com falhas. Aprove o Depurador Sênior para diagnosticar antes de curar.'
    );
    return;
  }

  if (!orchestrator.lastTestReport?.passed || !securityReport.passed) {
    orchestrator.log(
      'orchestrator',
      'Máximo de curas atingido ou cura não solicitada; seguindo com ressalvas.',
      'warning'
    );
  } else {
    orchestrator.log('orchestrator', 'Código aprovado nos testes e nas verificações de segurança.', 'success');
  }

  await orchestrator.pauseForApproval(
    'devops',
    'Segurança concluída. Aprove para testes de carga e caos (DevOps).'
  );
}

module.exports = { run };
