const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'reliability-test-token-24chars-x';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-reliab-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-reliab-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3093';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('runs.reliabilityStats (ADR-012)', () => {
  it('sem nenhuma run medida, retorna null nas taxas e measuredRuns=0', () => {
    const { runs } = fresh('../lib/db');
    const stats = runs.reliabilityStats();
    assert.equal(stats.measuredRuns, 0);
    assert.equal(stats.finishedWithoutInterventionRate, null);
  });

  it('agrega corretamente across runs medidas, ignorando runs sem reliability', () => {
    const { runs } = fresh('../lib/db');

    const a = runs.create({ prompt: 'run a', config: {} });
    runs.update(a.id, {
      reliability: {
        healingAttempts: 0,
        userFixInvoked: false,
        testsTotal: 4,
        testsPassed: 4,
        testsFailed: 0,
        securityIssuesFinal: 0,
        humanPassed: true,
        finishedWithoutIntervention: true
      }
    });

    const b = runs.create({ prompt: 'run b', config: {} });
    runs.update(b.id, {
      reliability: {
        healingAttempts: 2,
        userFixInvoked: true,
        testsTotal: 4,
        testsPassed: 2,
        testsFailed: 2,
        securityIssuesFinal: 1,
        humanPassed: false,
        finishedWithoutIntervention: false
      }
    });

    // Run sem reliability nenhuma (run ainda em andamento) — não deve entrar na conta
    runs.create({ prompt: 'run c ainda rodando', config: {} });

    const stats = runs.reliabilityStats();
    assert.equal(stats.measuredRuns, 2);
    assert.equal(stats.finishedWithoutInterventionRate, 0.5);
    assert.equal(stats.avgHealingAttempts, 1);
    assert.equal(stats.userFixInvokedRate, 0.5);
    assert.equal(stats.avgTestPassRate, (4 / 4 + 2 / 4) / 2);
    assert.equal(stats.humanPassedRate, 0.5);
  });

  it('agrega métricas de preflight quando presentes', () => {
    const { runs } = fresh('../lib/db');

    const a = runs.create({ prompt: 'preflight ok', config: {} });
    runs.update(a.id, {
      reliability: {
        healingAttempts: 0,
        userFixInvoked: false,
        testsTotal: 4,
        testsPassed: 4,
        testsFailed: 0,
        securityIssuesFinal: 0,
        humanPassed: true,
        preflightPassed: true,
        preflightFixAttempts: 0,
        forceQaUsed: false,
        preflightQaAligned: true,
        finishedWithoutIntervention: true
      }
    });

    const b = runs.create({ prompt: 'force qa', config: {} });
    runs.update(b.id, {
      reliability: {
        healingAttempts: 0,
        userFixInvoked: false,
        testsTotal: 4,
        testsPassed: 2,
        testsFailed: 2,
        securityIssuesFinal: 0,
        humanPassed: true,
        preflightPassed: false,
        preflightFixAttempts: 2,
        forceQaUsed: true,
        preflightQaAligned: false,
        finishedWithoutIntervention: false
      }
    });

    const stats = runs.reliabilityStats();
    assert.equal(stats.preflightPassRate, 0.5);
    assert.equal(stats.avgPreflightFixAttempts, 1);
    assert.equal(stats.forceQaRate, 0.5);
    assert.equal(stats.preflightQaParityRate, 0.5);
  });
});
