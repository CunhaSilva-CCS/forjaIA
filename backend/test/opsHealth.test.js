const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

function run(overrides = {}) {
  return {
    id: 'run-1',
    status: 'completed',
    started_at: '2026-08-29T10:00:00.000Z',
    finished_at: '2026-08-29T10:05:00.000Z',
    ...overrides
  };
}

describe('opsHealth.computeOpsHealth — achado real: nada disso existia agregado num lugar só antes deste ADR', () => {
  it('sem nenhum problema, ok:true e alerts vazio', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const result = computeOpsHealth({
      runsList: [run({ status: 'completed' }), run({ status: 'completed' })],
      cooldowns: []
    });
    assert.equal(result.ok, true);
    assert.equal(result.recentFailureStreak, 0);
    assert.deepEqual(result.alerts, []);
  });

  it('achado real: conta a sequência de falhas mais recentes, para no primeiro sucesso', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const result = computeOpsHealth({
      runsList: [
        run({ id: 'r4', status: 'failed' }),
        run({ id: 'r3', status: 'failed' }),
        run({ id: 'r2', status: 'failed' }),
        run({ id: 'r1', status: 'completed' }) // já não conta — a sequência parou aqui
      ],
      cooldowns: []
    });
    assert.equal(result.recentFailureStreak, 3);
    assert.equal(result.ok, false);
    assert.ok(result.alerts.some((a) => a.id === 'RECENT-FAILURE-STREAK' && a.severity === 'HIGH'));
  });

  it('sequência de falhas abaixo do teto não gera alerta HIGH', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const result = computeOpsHealth({
      runsList: [run({ status: 'failed' }), run({ status: 'failed' }), run({ status: 'completed' })],
      cooldowns: [],
      failureStreakAlertThreshold: 3
    });
    assert.equal(result.recentFailureStreak, 2);
    assert.equal(result.ok, true);
    assert.deepEqual(result.alerts, []);
  });

  it('lastSuccessfulRunAt acha a run "completed" mais recente, ignorando as falhas mais novas', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const result = computeOpsHealth({
      runsList: [
        run({ status: 'failed', finished_at: '2026-08-29T12:00:00.000Z' }),
        run({ status: 'completed', finished_at: '2026-08-29T11:00:00.000Z' }),
        run({ status: 'completed', finished_at: '2026-08-29T09:00:00.000Z' })
      ],
      cooldowns: []
    });
    assert.equal(result.lastSuccessfulRunAt, '2026-08-29T11:00:00.000Z');
  });

  it('sem nenhuma run completed ainda, lastSuccessfulRunAt é null (não quebra)', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const result = computeOpsHealth({ runsList: [run({ status: 'failed' })], cooldowns: [] });
    assert.equal(result.lastSuccessfulRunAt, null);
  });

  it('cooldown de provedor ativo vira alerta LOW — não derruba ok (é aviso, não incidente)', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const result = computeOpsHealth({
      runsList: [run({ status: 'completed' })],
      cooldowns: [{ provider: 'claude', until: '2026-08-29T13:00:00.000Z', reason: 'sem crédito' }]
    });
    assert.equal(result.ok, true, 'só alerta LOW não deveria marcar ok:false');
    assert.equal(result.activeCooldowns.length, 1);
    assert.ok(result.alerts.some((a) => a.id === 'PROVIDER-COOLDOWN' && a.severity === 'LOW' && /claude/.test(a.message)));
  });

  it('achado real: run executando há muito mais tempo que o esperado vira alerta de run travada', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const orchestrator = {
      isExecuting: true,
      currentTask: { id: 'run-travada', status: 'devops', startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString() }
    };
    const result = computeOpsHealth({ runsList: [], cooldowns: [], orchestrator, stuckRunMs: 45 * 60 * 1000 });
    assert.ok(result.stuckRun);
    assert.equal(result.stuckRun.runId, 'run-travada');
    assert.equal(result.ok, false);
    assert.ok(result.alerts.some((a) => a.id === 'RUN-STUCK' && a.severity === 'MEDIUM'));
  });

  it('run executando dentro do tempo esperado não vira alerta', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const orchestrator = {
      isExecuting: true,
      currentTask: { id: 'run-normal', status: 'qa', startTime: new Date(Date.now() - 60 * 1000).toISOString() }
    };
    const result = computeOpsHealth({ runsList: [], cooldowns: [], orchestrator, stuckRunMs: 45 * 60 * 1000 });
    assert.equal(result.stuckRun, null);
  });

  it('sem orchestrator (checagem fora do processo do servidor) nunca gera alerta de run travada', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const result = computeOpsHealth({ runsList: [], cooldowns: [] });
    assert.equal(result.stuckRun, null);
  });

  it('run aguardando aprovação (isExecuting:false) nunca é tratada como travada, mesmo há muito tempo parada', () => {
    const { computeOpsHealth } = fresh('../lib/opsHealth');
    const orchestrator = {
      isExecuting: false,
      currentTask: { id: 'run-esperando', status: 'awaiting_approval', startTime: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() }
    };
    const result = computeOpsHealth({ runsList: [], cooldowns: [], orchestrator });
    assert.equal(result.stuckRun, null);
  });
});
