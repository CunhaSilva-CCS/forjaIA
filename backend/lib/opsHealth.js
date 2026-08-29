/**
 * Saúde operacional agregada (ver ADR-033) — não é feature nova, é tornar visível o que o sistema
 * já sabe internamente mas nunca juntava num lugar só: sequência de falhas recentes, provedor em
 * cooldown, run travada há muito tempo. Sem isso, a única forma de saber que algo está errado é um
 * humano olhando o terminal ou lendo relatório por relatório — o gap mais sério apontado pela
 * própria auto-avaliação do projeto.
 *
 * Deliberadamente NÃO é uma stack de observabilidade nova (sem Prometheus/OpenTelemetry/Sentry) —
 * é um endpoint JSON simples o bastante pra um `curl` + `cron` externo verificar "está tudo bem?"
 * sem exigir infraestrutura nova. Se um dia justificar mais que isso, é uma decisão de escala
 * separada, não algo pra assumir sozinho aqui.
 */

/** Runs mais recentes (já ordenadas por started_at DESC pelo próprio runs.list) que falharam
 * seguidas, a partir da mais recente — para no primeiro sucesso/em-andamento. Um número alto aqui
 * é o sinal mais direto de "algo sistemático quebrou", não só uma run individual azarada. */
function recentFailureStreak(recentRuns) {
  let streak = 0;
  for (const run of recentRuns) {
    if (run.status === 'failed') {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

function lastSuccessfulRunAt(recentRuns) {
  const completed = recentRuns.find((r) => r.status === 'completed');
  return completed?.finished_at || completed?.started_at || null;
}

/** Uma run "travada" — executando (não aguardando aprovação, que é esperado ficar parado) há mais
 * tempo do que qualquer etapa individual do pipeline plausivelmente levaria. Não é um veredito
 * definitivo (uma cura pode legitimamente levar minutos), é um sinal pra alguém checar. */
function stuckRunAlert(orchestrator, maxExecutingMs) {
  if (!orchestrator?.isExecuting || !orchestrator.currentTask?.startTime) return null;
  const startedAt = new Date(orchestrator.currentTask.startTime).getTime();
  if (!Number.isFinite(startedAt)) return null;
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs < maxExecutingMs) return null;
  return {
    runId: orchestrator.currentTask.id,
    status: orchestrator.currentTask.status,
    executingForMs: elapsedMs
  };
}

const DEFAULT_FAILURE_STREAK_ALERT = Number(process.env.FORJA_FAILURE_STREAK_ALERT || 3);
const DEFAULT_STUCK_RUN_MS = Number(process.env.FORJA_STUCK_RUN_MS || 45 * 60 * 1000); // 45min — mais que o HARD_TIMEOUT_MS de expo run:* (15min) com folga

/**
 * `orchestrator` é opcional (o único sinal que depende de estado em memória, não do banco) — sem
 * ele, `stuckRun` sempre vem null, o resto dos sinais funciona igual (útil pra checar via CLI/script
 * fora do processo do servidor, sem uma instância de Orchestrator à mão).
 */
function computeOpsHealth({
  runsList,
  cooldowns,
  orchestrator = null,
  failureStreakAlertThreshold = DEFAULT_FAILURE_STREAK_ALERT,
  stuckRunMs = DEFAULT_STUCK_RUN_MS,
  recentLimit = 20
} = {}) {
  const recentRuns = (runsList || []).slice(0, recentLimit);
  const streak = recentFailureStreak(recentRuns);
  const stuckRun = stuckRunAlert(orchestrator, stuckRunMs);
  const activeCooldowns = cooldowns || [];

  const alerts = [];
  if (streak >= failureStreakAlertThreshold) {
    alerts.push({
      id: 'RECENT-FAILURE-STREAK',
      severity: 'HIGH',
      message: `${streak} runs seguidas falharam (das ${recentRuns.length} mais recentes) — provável problema sistemático, não uma run isolada.`
    });
  }
  if (stuckRun) {
    alerts.push({
      id: 'RUN-STUCK',
      severity: 'MEDIUM',
      message: `Run ${stuckRun.runId} executando há ${Math.round(stuckRun.executingForMs / 60000)}min na etapa "${stuckRun.status}" — acima do esperado.`
    });
  }
  for (const c of activeCooldowns) {
    alerts.push({
      id: 'PROVIDER-COOLDOWN',
      severity: 'LOW',
      message: `Provedor "${c.provider}" em cooldown até ${c.until} (${c.reason || 'motivo não registrado'}).`
    });
  }

  return {
    ok: alerts.every((a) => a.severity === 'LOW'),
    recentFailureStreak: streak,
    recentRunsChecked: recentRuns.length,
    lastSuccessfulRunAt: lastSuccessfulRunAt(recentRuns),
    stuckRun,
    activeCooldowns,
    alerts
  };
}

module.exports = { computeOpsHealth, recentFailureStreak, lastSuccessfulRunAt, stuckRunAlert };
