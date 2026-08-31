async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const coder = require('../coder');
  orchestrator.broadcast('agent-active', { agent: 'coder' });
  orchestrator.log('coder', 'Geração de código iniciada a partir da arquitetura aprovada...', 'info');

  const codeOutput = await coder.execute(orchestrator.savedPrompt, orchestrator.savedPlan, runConfig, orchestrator);
  orchestrator.throwIfAborted();

  const { runPreflightPipeline } = require('../../lib/preflightPipeline');
  const { files, preflight, fixAttempts } = await runPreflightPipeline({
    files: codeOutput.files,
    plan: orchestrator.savedPlan,
    prompt: orchestrator.savedPrompt,
    seniorReview: codeOutput.seniorReview,
    runConfig,
    orchestrator
  });

  orchestrator.currentTask.files = files;
  orchestrator.saveFileVersions(files);
  orchestrator.persistTask({ files });
  orchestrator.currentTask.preflightReport = preflight;
  orchestrator.currentTask.preflightFixAttempts = fixAttempts;
  orchestrator.currentTask.coderSeniorReview = codeOutput.seniorReview || null;
  orchestrator.currentTask.preflightRequired = true;

  const ok = preflight.tests.filter((t) => t.passed).length;
  const total = preflight.tests.length;

  orchestrator.log(
    'coder',
    preflight.passed
      ? `Preflight OK (${ok}/${total}) — pronto para QA determinístico.`
      : `Preflight reprovado (${ok}/${total}) — QA bloqueado até forceQa ou nova run.`,
    preflight.passed ? 'success' : 'error'
  );

  orchestrator.log('coder', 'Código-fonte gerado para todos os arquivos planejados.', 'success');
  orchestrator.broadcast('agent-finished', {
    agent: 'coder',
    status: preflight.passed ? 'success' : 'failed',
    data: { files, preflightReport: preflight, seniorReview: codeOutput.seniorReview || null }
  });

  await orchestrator.pauseForApproval(
    'qa',
    preflight.passed
      ? `Preflight ${ok}/${total} OK — cenários do plano passaram na sandbox. Aprove para QA formal.`
      : `Preflight falhou (${ok}/${total}). QA bloqueado (fail-closed). Corrija ou use forceQa na aprovação.`
  );
}

module.exports = { run };
