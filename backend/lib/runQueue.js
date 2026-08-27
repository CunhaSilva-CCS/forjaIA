const { runs } = require('./db');

/**
 * Fila simples: se a forja estiver ocupada, o run fica `queued`
 * e é iniciado automaticamente ao liberar.
 */
const runQueue = {
  enqueue({ prompt, config, owner, mode = 'forge' }) {
    const queued = runs.listQueued();
    const position = queued.length + 1;
    const run = runs.create({
      projectId: config?.projectId,
      prompt: prompt || (mode === 'validate' ? `Validar ${config?.sourcePath || ''}` : 'fila'),
      config: { ...config, mode, queuedAt: new Date().toISOString() },
      owner,
      status: 'queued'
    });
    runs.update(run.id, { queuePosition: position });
    return runs.get(run.id);
  },

  async tryStartNext(orchestrator) {
    if (!orchestrator || orchestrator.hasBlockingTask()) return null;
    const next = runs.nextQueued();
    if (!next) return null;

    const cfg = { ...(next.config || {}), projectId: next.project_id };
    const owner = next.owner_id
      ? { id: next.owner_id, name: next.owner_name, role: next.owner_role }
      : null;

    try {
      if (cfg.mode === 'validate' && cfg.sourcePath) {
        await orchestrator.startQueuedValidate(next, cfg, owner);
      } else {
        await orchestrator.startQueuedRun(next, cfg, owner);
      }
      return next.id;
    } catch (err) {
      runs.update(next.id, {
        status: 'failed',
        error: err.message,
        finishedAt: new Date().toISOString()
      });
      orchestrator.log?.('orchestrator', `Falha ao promover fila ${next.id}: ${err.message}`, 'error');
      return null;
    }
  }
};

module.exports = { runQueue };
