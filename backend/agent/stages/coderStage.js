async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const coder = require('../coder');
  orchestrator.broadcast('agent-active', { agent: 'coder' });
  orchestrator.log('coder', 'Geração de código iniciada a partir da arquitetura aprovada...', 'info');

  const codeOutput = await coder.execute(orchestrator.savedPrompt, orchestrator.savedPlan, runConfig, orchestrator);
  orchestrator.throwIfAborted();
  orchestrator.currentTask.files = codeOutput.files;
  orchestrator.saveFileVersions(codeOutput.files);
  orchestrator.persistTask({ files: orchestrator.currentTask.files });

  const { runCoderPreflight } = require('../../lib/coderPreflight');
  const preflight = await runCoderPreflight(
    codeOutput.files,
    orchestrator.savedPlan,
    orchestrator
  );
  orchestrator.currentTask.preflightReport = preflight;

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
  orchestrator.broadcast('agent-finished', { agent: 'coder', status: 'success', data: codeOutput });
  await orchestrator.pauseForApproval(
    'qa',
    preflight.passed
      ? `Código gerado (preflight ${ok}/${total} OK). Aprove para executar a suíte de QA.`
      : `Código gerado, mas preflight falhou (${ok}/${total}). Revise o terminal e corrija antes do QA.`
  );
}

module.exports = { run };
