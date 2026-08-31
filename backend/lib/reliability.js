/**
 * Confiabilidade medida por run (ver ADR-012) — nunca uma estimativa, só o que foi de fato
 * observado durante a execução: quantas vezes o Curador precisou agir, se o usuário precisou
 * relatar um erro manualmente depois da aprovação, e o resultado final de QA/Segurança/Humano.
 * Função pura pra ficar testável isolada do resto do orquestrador (que só chama e persiste).
 */
function computeReliability({
  healingAttempts = 0,
  userFixInvoked = false,
  summary,
  preflightPassed = null,
  preflightFixAttempts = 0,
  forceQaUsed = false
}) {
  const testsTotal = summary?.testsTotal || 0;
  const testsPassed = summary?.testsPassed || 0;
  const testsFailed = summary?.testsFailed ?? Math.max(0, testsTotal - testsPassed);
  const securityIssuesFinal = summary?.securityIssues || 0;
  const humanPassed = summary?.humanPassed ?? null;
  const qaPassed = testsTotal > 0 ? testsFailed === 0 : null;

  const hadPreflight = preflightPassed !== null && preflightPassed !== undefined;
  const preflightQaAligned =
    hadPreflight && qaPassed !== null ? preflightPassed === qaPassed : null;

  const preflightClean =
    !hadPreflight ||
    (preflightPassed === true && !forceQaUsed && (preflightFixAttempts || 0) === 0);

  return {
    healingAttempts,
    userFixInvoked: Boolean(userFixInvoked),
    testsTotal,
    testsPassed,
    testsFailed,
    securityIssuesFinal,
    humanPassed,
    preflightPassed: hadPreflight ? Boolean(preflightPassed) : null,
    preflightFixAttempts: hadPreflight ? Number(preflightFixAttempts || 0) : null,
    forceQaUsed: hadPreflight ? Boolean(forceQaUsed) : null,
    preflightQaAligned,
    finishedWithoutIntervention:
      healingAttempts === 0 &&
      !userFixInvoked &&
      testsFailed === 0 &&
      securityIssuesFinal === 0 &&
      humanPassed !== false &&
      preflightClean
  };
}

module.exports = { computeReliability };
