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
  orchestrator.log('coder', 'Código-fonte gerado para todos os arquivos planejados.', 'success');
  orchestrator.broadcast('agent-finished', { agent: 'coder', status: 'success', data: codeOutput });
  await orchestrator.pauseForApproval('qa', 'Código gerado. Aprove para executar a suíte de QA.');
}

module.exports = { run };
