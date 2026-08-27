async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const userFix = require('../userFix');
  orchestrator.broadcast('agent-active', { agent: 'userFix' });

  const report = {
    userReport: runConfig.userReport || orchestrator.savedConfig?.userReport || '',
    humanReport:
      runConfig.humanReport || orchestrator.savedConfig?.humanReport || orchestrator.currentTask?.humanReport || null
  };

  try {
    const fixedFiles = await userFix.execute(orchestrator.currentTask.files, report, runConfig, orchestrator);
    orchestrator.throwIfAborted();
    orchestrator.currentTask.files = fixedFiles;
    orchestrator.saveFileVersions(fixedFiles);
    orchestrator.savedConfig = {
      ...orchestrator.savedConfig,
      userReport: null,
      lastUserReport: report.userReport || null
    };
    orchestrator.persistTask({ files: orchestrator.currentTask.files, config: orchestrator.savedConfig });
    if (runConfig.mode === 'validate' || orchestrator.savedConfig?.mode === 'validate') {
      orchestrator.writeFilesToWorkspace(
        runConfig.targetPath || runConfig.sourcePath || orchestrator.savedConfig?.sourcePath,
        fixedFiles
      );
    }
    orchestrator.broadcast('agent-finished', { agent: 'userFix', status: 'success', data: fixedFiles });
  } catch (fixErr) {
    if (fixErr.cancelled) throw fixErr;
    orchestrator.log('userFix', `Correção indisponível (${fixErr.message}).`, 'warning');
    orchestrator.broadcast('agent-finished', {
      agent: 'userFix',
      status: 'failed',
      data: { error: fixErr.message }
    });
    await orchestrator.pauseForApproval(
      'userFix',
      `Corretor do Usuário falhou (${fixErr.message}). Ajuste o relato e aprove para tentar de novo.`
    );
    return;
  }

  await orchestrator.pauseForApproval(
    'qa',
    'Correções do relato humano aplicadas. Aprove para reexecutar o QA.'
  );
}

module.exports = { run };
