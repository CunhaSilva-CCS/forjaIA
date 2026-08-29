const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'budget-cap-test-token-24chars-x';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-budget-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-budget-${Date.now()}.db`);

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

function makeRunningTask(db) {
  const run = db.runs.create({ prompt: 'budget test' });
  return run.id;
}

describe('Orchestrator — teto de orçamento por run (ADR-024, achado real)', () => {
  it('recordTokens acumula estimatedCostUsd corretamente', () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { id: makeRunningTask(db), status: 'coder', tokenStats: null };
    orch.savedConfig = {};

    orch.recordTokens({ prompt: 1_000_000, completion: 1_000_000, total: 2_000_000 }, { provider: 'claude', model: 'claude-sonnet-4-20250514' });
    assert.equal(orch.currentTask.tokenStats.estimatedCostUsd, 18); // $3 prompt + $15 completion por 1M
  });

  it('provedor sem preço conhecido não quebra e não some no total (fica undefined até um provedor conhecido somar)', () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { id: makeRunningTask(db), status: 'coder', tokenStats: null };
    orch.savedConfig = {};

    orch.recordTokens({ prompt: 1000, completion: 1000, total: 2000 }, { provider: 'provedor-desconhecido', model: 'x' });
    assert.equal(orch.currentTask.tokenStats.estimatedCostUsd, 0);
    assert.equal(orch.currentTask.budgetExceeded, undefined);
  });

  it('achado real: marca budgetExceeded quando o gasto estimado passa do teto configurado (savedConfig.budgetUsd)', () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { id: makeRunningTask(db), status: 'coder', tokenStats: null };
    orch.savedConfig = { budgetUsd: 1 }; // teto de $1 pra esta run

    orch.recordTokens({ prompt: 500_000, completion: 0, total: 500_000 }, { provider: 'claude', model: 'claude-sonnet-4-20250514' });
    // $3/1M * 0.5M = $1.50 > teto de $1
    assert.equal(orch.currentTask.budgetExceeded, true);
  });

  it('throwIfAborted lança (sem .cancelled) quando budgetExceeded está marcado', () => {
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { budgetExceeded: true, tokenStats: { estimatedCostUsd: 5.5 } };
    orch.savedConfig = { budgetUsd: 5 };

    assert.throws(() => orch.throwIfAborted(), (err) => {
      assert.match(err.message, /Orçamento estimado de \$5\.00 excedido/);
      assert.notEqual(err.cancelled, true);
      return true;
    });
  });

  it('throwIfAborted não lança quando budgetExceeded é false/undefined', () => {
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { budgetExceeded: false };
    assert.doesNotThrow(() => orch.throwIfAborted());
    orch.currentTask = {};
    assert.doesNotThrow(() => orch.throwIfAborted());
  });

  it('teto desligado (0/ausente) nunca marca budgetExceeded, não importa o gasto', () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    orch.currentTask = { id: makeRunningTask(db), status: 'coder', tokenStats: null };
    orch.savedConfig = {}; // sem budgetUsd — e config.runBudgetUsd default é 0 (desligado)

    orch.recordTokens({ prompt: 10_000_000, completion: 10_000_000, total: 20_000_000 }, { provider: 'claude', model: 'claude-sonnet-4-20250514' });
    assert.equal(orch.currentTask.budgetExceeded, undefined);
  });
});

describe('Orchestrator.approveAndContinue — aprovar reseta budgetExceeded (achado real)', () => {
  it('aprovar limpa o flag, permitindo a etapa seguinte rodar de novo', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = makeRunningTask(db);
    db.runs.update(runId, { files: [{ path: 'a.js', content: 'x' }] });

    orch.currentTask = {
      id: runId,
      status: 'awaiting_approval',
      pendingNextStage: 'qa',
      budgetExceeded: true,
      files: [{ path: 'a.js' }]
    };
    orch.savedConfig = { mode: 'validate', budgetUsd: 1 };
    orch.savedPlan = { files: [], adrs: [] };
    orch.isExecuting = false;

    // Corta a execução real da etapa (não é o que este teste quer verificar) — só confirma que o
    // flag já foi resetado ANTES de runStage ser chamado.
    orch.runStage = async () => {
      assert.equal(orch.currentTask.budgetExceeded, false, 'budgetExceeded deveria estar resetado antes de rodar a etapa');
      throw Object.assign(new Error('corta aqui de propósito'), { cancelled: true });
    };

    await orch.approveAndContinue({}, null, { role: 'admin', isAdmin: true });
    assert.equal(orch.currentTask.budgetExceeded, false);
  });

  it('achado real: aprovar com budgetUsd novo no customConfig levanta o teto pra próxima checagem', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = makeRunningTask(db);
    db.runs.update(runId, { files: [{ path: 'a.js', content: 'x' }] });

    orch.currentTask = {
      id: runId,
      status: 'awaiting_approval',
      pendingNextStage: 'qa',
      budgetExceeded: true,
      files: [{ path: 'a.js' }]
    };
    orch.savedConfig = { mode: 'validate', budgetUsd: 1 };
    orch.savedPlan = { files: [], adrs: [] };
    orch.isExecuting = false;
    orch.runStage = async () => {
      throw Object.assign(new Error('corta aqui de propósito'), { cancelled: true });
    };

    await orch.approveAndContinue({ budgetUsd: 100 }, null, { role: 'admin', isAdmin: true });
    assert.equal(orch.savedConfig.budgetUsd, 100);
  });
});
