async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const attempt = orchestrator.healingAttempts + 1;
  // Última chance antes de desistir (ver ADR-013): se as tentativas anteriores já falharam com
  // o mesmo provedor, insistir nele pela 3ª vez tende a repetir o mesmo raciocínio errado.
  // Escalar pra um provedor diferente só aqui — não em toda tentativa — é o ponto onde vale o
  // risco de trocar de "cérebro" no meio da run.
  const isLastAttempt = attempt >= orchestrator.maxHealingAttempts;

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
          orchestrator.lastDiagnosis || orchestrator.currentTask.diagnosis || orchestrator.savedConfig?.lastDiagnosis,
        escalateProvider: isLastAttempt
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
    // Uma tentativa falha também conta pro limite — sem isso, healingAttempts nunca sobe em
    // falha e uma sequência de curas malsucedidas pausa em "healer" indefinidamente, sempre
    // pedindo pra tentar de novo, sem nunca bater o teto e seguir em frente.
    orchestrator.healingAttempts = attempt;
    orchestrator.savedConfig = { ...orchestrator.savedConfig, healingAttempts: orchestrator.healingAttempts };
    orchestrator.log('healer', `Cura indisponível (${healErr.message}).`, 'warning');
    orchestrator.broadcast('agent-finished', {
      agent: 'healer',
      status: 'failed',
      data: { error: healErr.message }
    });
    if (orchestrator.healingAttempts >= orchestrator.maxHealingAttempts) {
      orchestrator.log(
        'orchestrator',
        `Máximo de tentativas de cura atingido (${orchestrator.healingAttempts}) sem sucesso; seguindo com ressalvas.`,
        'warning'
      );
      await orchestrator.pauseForApproval(
        'devops',
        `Curador falhou ${orchestrator.healingAttempts}x seguidas (${healErr.message}). Limite de tentativas atingido — aprove para seguir mesmo assim ou cancele.`
      );
      return;
    }
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
