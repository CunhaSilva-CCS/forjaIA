async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const attempt = orchestrator.healingAttempts + 1;

  try {
    const healer = require('../healer');
    orchestrator.broadcast('agent-active', { agent: 'healer' });
    const healedFiles = await healer.execute(
      orchestrator.currentTask.files,
      orchestrator.lastTestReport || { tests: orchestrator.currentTask.tests, passed: false },
      orchestrator.lastSecurityReport || { issues: orchestrator.currentTask.securityIssues, passed: false },
      {
        ...runConfig,
        diagnosis:
          orchestrator.lastDiagnosis || orchestrator.currentTask.diagnosis || orchestrator.savedConfig?.lastDiagnosis
      },
      orchestrator
    );
    orchestrator.throwIfAborted();
    orchestrator.healingAttempts = attempt;
    orchestrator.savedConfig = { ...orchestrator.savedConfig, healingAttempts: orchestrator.healingAttempts };
    orchestrator.currentTask.files = healedFiles;
    orchestrator.saveFileVersions(healedFiles);
    orchestrator.persistTask({ files: orchestrator.currentTask.files });
    if (runConfig.mode === 'validate' || orchestrator.savedConfig?.mode === 'validate') {
      orchestrator.writeFilesToWorkspace(
        runConfig.targetPath || runConfig.sourcePath || orchestrator.savedConfig?.sourcePath,
        healedFiles
      );
    }
    orchestrator.log('healer', `Tentativa de cura ${orchestrator.healingAttempts} concluída.`, 'success');
    orchestrator.broadcast('agent-finished', { agent: 'healer', status: 'success', data: healedFiles });
  } catch (healErr) {
    if (healErr.cancelled) throw healErr;
    orchestrator.log('healer', `Cura indisponível (${healErr.message}).`, 'warning');
    orchestrator.broadcast('agent-finished', {
      agent: 'healer',
      status: 'failed',
      data: { error: healErr.message }
    });
    await orchestrator.pauseForApproval(
      'healer',
      `Curador falhou (${healErr.message}). Aprove para tentar novamente ou cancele a execução.`
    );
    return;
  }

  await orchestrator.pauseForApproval(
    'qa',
    `Cura #${orchestrator.healingAttempts} concluída. Aprove para reexecutar o QA.`
  );
}

module.exports = { run };
