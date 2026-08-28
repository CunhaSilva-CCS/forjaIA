/**
 * Confiabilidade medida por run (ver ADR-012) — nunca uma estimativa, só o que foi de fato
 * observado durante a execução: quantas vezes o Curador precisou agir, se o usuário precisou
 * relatar um erro manualmente depois da aprovação, e o resultado final de QA/Segurança/Humano.
 * Função pura pra ficar testável isolada do resto do orquestrador (que só chama e persiste).
 */
function computeReliability({ healingAttempts = 0, userFixInvoked = false, summary }) {
  const testsTotal = summary?.testsTotal || 0;
  const testsPassed = summary?.testsPassed || 0;
  const testsFailed = summary?.testsFailed ?? Math.max(0, testsTotal - testsPassed);
  const securityIssuesFinal = summary?.securityIssues || 0;
  const humanPassed = summary?.humanPassed ?? null;

  return {
    healingAttempts,
    userFixInvoked: Boolean(userFixInvoked),
    testsTotal,
    testsPassed,
    testsFailed,
    securityIssuesFinal,
    humanPassed,
    finishedWithoutIntervention:
      healingAttempts === 0 &&
      !userFixInvoked &&
      testsFailed === 0 &&
      securityIssuesFinal === 0 &&
      humanPassed !== false
  };
}

module.exports = { computeReliability };
