const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'queue-user-report-test-token-24c';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-quf-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-quf-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3099';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('Orchestrator.queueUserReport — não ressuscita run já terminada (achado real)', () => {
  it('rejeita quando a run já está completed', () => {
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { id: 'fake-run-1', status: 'completed', files: [{ path: 'a.js' }] };
    assert.throws(() => orch.queueUserReport('achei um bug'), /já terminou/);
    // Continua terminada — não deve ter virado awaiting_approval.
    assert.equal(orch.currentTask.status, 'completed');
  });

  it('rejeita quando a run já está failed', () => {
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { id: 'fake-run-2', status: 'failed', files: [{ path: 'a.js' }] };
    assert.throws(() => orch.queueUserReport('achei um bug'), /já terminou/);
  });

  it('rejeita quando a run já está cancelled', () => {
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { id: 'fake-run-3', status: 'cancelled', files: [{ path: 'a.js' }] };
    assert.throws(() => orch.queueUserReport('achei um bug'), /já terminou/);
  });

  it('achado real: userFixInvoked sobrevive a um restart do servidor (restorePendingApproval)', () => {
    const db = fresh('../lib/db');
    const run = db.runs.create({ prompt: 'run que vai reiniciar' });
    db.runs.update(run.id, { files: [{ path: 'a.js', content: 'x' }] });

    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { id: run.id, status: 'awaiting_approval', files: [{ path: 'a.js' }] };
    orch.isExecuting = false;
    orch.queueUserReport('achei um bug'); // persiste de verdade — não mocka persistTask aqui

    // Simula um restart: uma instância NOVA do Orchestrator lê o estado do banco do zero.
    const OrchestratorFresh = fresh('../agent/orchestrator');
    const restarted = new OrchestratorFresh(null);
    assert.equal(
      restarted.userFixInvoked,
      true,
      'userFixInvoked deveria ter sido restaurado do config persistido, não voltar a false'
    );
  });

  it('continua aceitando o relato numa run em andamento (comportamento anterior preservado)', () => {
    const db = fresh('../lib/db');
    const run = db.runs.create({ prompt: 'run em andamento' });
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { id: run.id, status: 'awaiting_approval', files: [{ path: 'a.js' }] };
    orch.isExecuting = false;
    orch.persistTask = () => {};
    const result = orch.queueUserReport('achei um bug');
    assert.equal(result.success, true);
    assert.equal(orch.currentTask.status, 'awaiting_approval');
  });
});
