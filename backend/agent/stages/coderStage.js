async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const coder = require('../coder');
  orchestrator.broadcast('agent-active', { agent: 'coder' });
  orchestrator.log('coder', 'Geração de código iniciada a partir da arquitetura aprovada...', 'info');

  const codeOutput = await coder.execute(orchestrator.savedPrompt, orchestrator.savedPlan, runConfig, orchestrator);
  orchestrator.throwIfAborted();

  let files = codeOutput.files;
  orchestrator.currentTask.files = files;
  orchestrator.saveFileVersions(files);
  orchestrator.persistTask({ files: orchestrator.currentTask.files });

  const { runCoderPreflight } = require('../../lib/coderPreflight');
  let preflight = await runCoderPreflight(files, orchestrator.savedPlan, orchestrator);

  if (!preflight.passed) {
    const { remediatePreflightFailures } = require('../../lib/coderPreflightFix');
    files = await remediatePreflightFailures(
      files,
      orchestrator.savedPlan,
      preflight,
      orchestrator.savedPrompt,
      runConfig,
      orchestrator
    );
    orchestrator.throwIfAborted();
    orchestrator.currentTask.files = files;
    orchestrator.saveFileVersions(files);
    orchestrator.persistTask({ files });
    preflight = await runCoderPreflight(files, orchestrator.savedPlan, orchestrator);
  }

  orchestrator.currentTask.preflightReport = preflight;
  orchestrator.currentTask.coderSeniorReview = codeOutput.seniorReview || null;

  const ok = preflight.tests.filter((t) => t.passed).length;
  const total = preflight.tests.length;
  orchestrator.log(
    'coder',
    preflight.passed
      ? `Preflight OK (${ok}/${total}) — código alinhado aos cenários do plano.`
      : `Preflight com falhas (${ok}/${total}) — revise logs antes de aprovar QA.`,
    preflight.passed ? 'success' : 'warning'
  );

  orchestrator.log('coder', 'Código-fonte gerado para todos os arquivos planejados.', 'success');
  orchestrator.broadcast('agent-finished', {
    agent: 'coder',
    status: 'success',
    data: { files, preflightReport: preflight, seniorReview: codeOutput.seniorReview || null }
  });
  await orchestrator.pauseForApproval(
    'qa',
    preflight.passed
      ? `Código gerado (preflight ${ok}/${total} OK). Aprove para executar a suíte de QA.`
      : `Código gerado, mas preflight falhou (${ok}/${total}). Revise o terminal e corrija antes do QA.`
  );
}

module.exports = { run };
