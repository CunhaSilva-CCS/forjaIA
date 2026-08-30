const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeReliability } = require('../lib/reliability');

describe('computeReliability (ADR-012)', () => {
  it('finishedWithoutIntervention=true quando tudo passou sem cura/relato manual', () => {
    const r = computeReliability({
      healingAttempts: 0,
      userFixInvoked: false,
      summary: { testsTotal: 5, testsPassed: 5, testsFailed: 0, securityIssues: 0, humanPassed: true }
    });
    assert.equal(r.finishedWithoutIntervention, true);
  });

  it('finishedWithoutIntervention=false se o Curador precisou agir', () => {
    const r = computeReliability({
      healingAttempts: 2,
      userFixInvoked: false,
      summary: { testsTotal: 5, testsPassed: 5, testsFailed: 0, securityIssues: 0, humanPassed: true }
    });
    assert.equal(r.finishedWithoutIntervention, false);
    assert.equal(r.healingAttempts, 2);
  });

  it('finishedWithoutIntervention=false se o usuário relatou erro manualmente', () => {
    const r = computeReliability({
      healingAttempts: 0,
      userFixInvoked: true,
      summary: { testsTotal: 3, testsPassed: 3, testsFailed: 0, securityIssues: 0, humanPassed: true }
    });
    assert.equal(r.finishedWithoutIntervention, false);
  });

  it('finishedWithoutIntervention=false se sobrou teste falho ou achado de segurança', () => {
    const semTeste = computeReliability({
      summary: { testsTotal: 4, testsPassed: 3, testsFailed: 1, securityIssues: 0, humanPassed: true }
    });
    const semSeguranca = computeReliability({
      summary: { testsTotal: 4, testsPassed: 4, testsFailed: 0, securityIssues: 1, humanPassed: true }
    });
    assert.equal(semTeste.finishedWithoutIntervention, false);
    assert.equal(semSeguranca.finishedWithoutIntervention, false);
  });

  it('humanPassed=null (etapa Humano não rodou) não bloqueia finishedWithoutIntervention', () => {
    const r = computeReliability({
      summary: { testsTotal: 2, testsPassed: 2, testsFailed: 0, securityIssues: 0, humanPassed: null }
    });
    assert.equal(r.finishedWithoutIntervention, true);
    assert.equal(r.humanPassed, null);
  });

  it('humanPassed=false bloqueia finishedWithoutIntervention', () => {
    const r = computeReliability({
      summary: { testsTotal: 2, testsPassed: 2, testsFailed: 0, securityIssues: 0, humanPassed: false }
    });
    assert.equal(r.finishedWithoutIntervention, false);
  });

  it('preflight reprovado ou forceQa bloqueia finishedWithoutIntervention', () => {
    const base = {
      summary: { testsTotal: 2, testsPassed: 2, testsFailed: 0, securityIssues: 0, humanPassed: true }
    };
    assert.equal(
      computeReliability({ ...base, preflightPassed: false, preflightFixAttempts: 0 }).finishedWithoutIntervention,
      false
    );
    assert.equal(
      computeReliability({ ...base, preflightPassed: true, forceQaUsed: true }).finishedWithoutIntervention,
      false
    );
    assert.equal(
      computeReliability({ ...base, preflightPassed: true, preflightFixAttempts: 1 }).finishedWithoutIntervention,
      false
    );
  });

  it('preflightQaAligned compara resultado preflight vs QA', () => {
    const aligned = computeReliability({
      preflightPassed: true,
      summary: { testsTotal: 2, testsPassed: 2, testsFailed: 0, securityIssues: 0, humanPassed: true }
    });
    assert.equal(aligned.preflightQaAligned, true);

    const regression = computeReliability({
      preflightPassed: true,
      summary: { testsTotal: 2, testsPassed: 1, testsFailed: 1, securityIssues: 0, humanPassed: true }
    });
    assert.equal(regression.preflightQaAligned, false);
  });

  it('modo validate sem preflight não altera métricas de preflight', () => {
    const r = computeReliability({
      summary: { testsTotal: 2, testsPassed: 2, testsFailed: 0, securityIssues: 0, humanPassed: true }
    });
    assert.equal(r.preflightPassed, null);
    assert.equal(r.preflightQaAligned, null);
    assert.equal(r.finishedWithoutIntervention, true);
  });
});
