async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const userFix = require('../userFix');
  orchestrator.broadcast('agent-active', { agent: 'userFix' });

  const report = {
    userReport: runConfig.userReport || orchestrator.savedConfig?.userReport || '',
    humanReport:
      runConfig.humanReport || orchestrator.savedConfig?.humanReport || orchestrator.currentTask?.humanReport || null
  };

  // Achado real (auditoria funcional ao vivo): sem isto, o Corretor retentava indefinidamente
  // com o MESMO provedor em cada falha — 4 tentativas seguidas falharam em Ollama local antes de
  // acertar na 5ª, só por sorte. Mesmo raciocínio do Curador (ADR-013): insistir no provedor que
  // já falhou tende a repetir o mesmo erro de raciocínio; escala a partir da 3ª tentativa.
  const attempt = orchestrator.userFixAttempts + 1;
  const shouldEscalate = attempt >= orchestrator.maxUserFixAttemptsBeforeEscalate;

  try {
    const fixedFiles = await userFix.execute(
      orchestrator.currentTask.files,
      report,
      { ...runConfig, escalateProvider: shouldEscalate },
      orchestrator
    );
    orchestrator.throwIfAborted();
    orchestrator.userFixAttempts = attempt;
    orchestrator.currentTask.files = fixedFiles;
    orchestrator.saveFileVersions(fixedFiles);
    orchestrator.savedConfig = {
      ...orchestrator.savedConfig,
      userReport: null,
      lastUserReport: report.userReport || null,
      userFixAttempts: orchestrator.userFixAttempts
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
    // Uma tentativa falha também conta pro contador — sem isso, attempt nunca sobe em falha e a
    // escalada nunca chegaria (mesmo bug que existia em healerStage.js antes do ADR-013).
    orchestrator.userFixAttempts = attempt;
    orchestrator.savedConfig = { ...orchestrator.savedConfig, userFixAttempts: orchestrator.userFixAttempts };
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
