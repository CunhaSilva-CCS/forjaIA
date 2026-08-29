/**
 * Agendador opcional da auditoria independente (Semgrep + npm audit contra o próprio ForjaIA,
 * ver ADR-021) — desligado por padrão (`FORJA_AUDIT_SCHEDULE_HOURS=0`). Deliberadamente opt-in:
 * roda ferramenta externa pesada num intervalo fixo, então só liga se o operador pedir.
 */
const config = require('./config');

let timer = null;

function startAuditScheduler(orchestrator) {
  if (timer) return; // já iniciado — chamado de novo não duplica o intervalo
  const hours = config.auditScheduleHours;
  if (!hours || hours <= 0) return;

  // Override em ms só pra teste (injeta um intervalo curto sem precisar de frações de hora
  // estranhas) — em produção normal, só FORJA_AUDIT_SCHEDULE_HOURS importa.
  const intervalMs = Number(process.env.FORJA_AUDIT_SCHEDULE_INTERVAL_MS) || hours * 60 * 60 * 1000;

  const run = async () => {
    const { auditRuns, resolveSelfTargetDir, runIndependentAudit } = require('./independentAudit');
    const targetDir = resolveSelfTargetDir();
    const row = auditRuns.create({ target: 'self', targetPath: targetDir });
    orchestrator?.broadcast?.('audit-started', { id: row.id, target: 'self', targetPath: targetDir, scheduled: true });
    try {
      const result = await runIndependentAudit({ target: 'self', targetDir });
      auditRuns.complete(row.id, result);
      orchestrator?.broadcast?.('audit-finished', { id: row.id, summary: result.summary, scheduled: true });
    } catch (err) {
      auditRuns.fail(row.id, err);
      orchestrator?.broadcast?.('audit-finished', { id: row.id, error: err.message, scheduled: true });
    }
  };

  timer = setInterval(run, intervalMs);
  timer.unref?.(); // não deve ser o único motivo do processo continuar vivo (relevante em teste)
}

function stopAuditScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startAuditScheduler, stopAuditScheduler };
