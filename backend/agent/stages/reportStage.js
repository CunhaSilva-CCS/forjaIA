async function run(orchestrator) {
  orchestrator.throwIfAborted();
  const prod = orchestrator.currentTask.productionReady || orchestrator.savedConfig?.productionReady;
  if (!prod?.ready) {
    throw new Error(
      'Relatório final bloqueado: checklist de produção não aprovado. Execute prodReady antes.'
    );
  }

  const ok = await orchestrator.emitReportPdf();
  orchestrator.throwIfAborted();
  if (!ok) {
    throw new Error('Falha ao gerar o relatório PDF');
  }
  orchestrator.currentTask.status = 'completed';
  orchestrator.currentTask.finishedAt = new Date().toISOString();
  orchestrator.currentTask.pendingNextStage = null;
  orchestrator.currentTask.productionReadyFlag = true;
  orchestrator.savedConfig = {
    ...orchestrator.savedConfig,
    pendingNextStage: null,
    productionReadyFlag: true
  };
  orchestrator.persistTask({
    status: 'completed',
    finishedAt: orchestrator.currentTask.finishedAt,
    config: orchestrator.savedConfig
  });
  orchestrator.log(
    'orchestrator',
    `Execução concluída — software pronto para produção (${orchestrator.currentTask.deployUrl || 'sem URL'}).`,
    'success'
  );
  orchestrator.broadcast('task-completed', orchestrator.currentTask);
  orchestrator.isExecuting = false;
  await orchestrator.promoteQueue();
}

module.exports = { run };
