const config = require('./config');
const { runCoderPreflight } = require('./coderPreflight');
const { remediatePreflightFailures, remediateSeniorGaps } = require('./coderPreflightFix');

function shouldRemediateSenior(seniorReview) {
  if (!seniorReview) return false;
  const verdict = String(seniorReview.verdict || '').toLowerCase();
  if (verdict === 'reprovado') return true;
  return Array.isArray(seniorReview.priorityFixes) && seniorReview.priorityFixes.length > 0;
}

/**
 * Pipeline completo pós-coder: correção sênior (se necessário) + preflight + até N remediações automáticas.
 */
async function runPreflightPipeline({
  files,
  plan,
  prompt,
  seniorReview,
  runConfig,
  orchestrator
}) {
  let currentFiles = files;
  const maxFixAttempts = Math.max(0, Number(config.preflightMaxFixAttempts ?? 2));

  if (shouldRemediateSenior(seniorReview)) {
    currentFiles = await remediateSeniorGaps(
      currentFiles,
      plan,
      seniorReview,
      prompt,
      runConfig,
      orchestrator
    );
    orchestrator.throwIfAborted?.();
  }

  let preflight = await runCoderPreflight(currentFiles, plan, orchestrator);
  let fixAttempt = 0;

  while (!preflight.passed && fixAttempt < maxFixAttempts) {
    orchestrator.log(
      'coder',
      `Preflight reprovado — remediação automática ${fixAttempt + 1}/${maxFixAttempts}...`,
      'info'
    );
    currentFiles = await remediatePreflightFailures(
      currentFiles,
      plan,
      preflight,
      prompt,
      runConfig,
      orchestrator,
      fixAttempt + 1
    );
    orchestrator.throwIfAborted?.();
    preflight = await runCoderPreflight(currentFiles, plan, orchestrator);
    fixAttempt += 1;
  }

  return { files: currentFiles, preflight, fixAttempts: fixAttempt };
}

module.exports = {
  runPreflightPipeline,
  shouldRemediateSenior
};
