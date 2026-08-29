const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'audit-scheduler-test-token-24chr';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-audit-sched-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-audit-sched-${Date.now()}.db`);

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('auditScheduler (ADR-021) — desligado por padrão, opt-in via env', () => {
  // Guarda a MESMA instância do módulo usada por cada teste — chamar fresh() de novo no afterEach
  // criaria um módulo novo (timer interno reseta pra null) em vez de parar o timer real que ficou
  // rodando, deixando-o vazar pro próximo teste.
  let activeScheduler = null;

  afterEach(() => {
    delete process.env.FORJA_AUDIT_SCHEDULE_HOURS;
    delete process.env.FORJA_AUDIT_SCHEDULE_INTERVAL_MS;
    activeScheduler?.stopAuditScheduler();
    activeScheduler = null;
  });

  it('não agenda nada quando FORJA_AUDIT_SCHEDULE_HOURS não está configurado', async () => {
    process.env.FORJA_AUDIT_SCHEDULE_HOURS = '';
    fresh('../lib/config');
    const independentAudit = fresh('../lib/independentAudit');
    let called = false;
    independentAudit.runIndependentAudit = async () => {
      called = true;
      return { findings: [], tools: {}, summary: 'x', finishedAt: new Date().toISOString() };
    };

    activeScheduler = fresh('../lib/auditScheduler');
    activeScheduler.startAuditScheduler({ broadcast: () => {} });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(called, false);
  });

  it('achado real: quando habilitado, dispara no intervalo configurado e persiste o resultado', async () => {
    process.env.FORJA_AUDIT_SCHEDULE_HOURS = '1'; // qualquer valor > 0 liga o agendador
    process.env.FORJA_AUDIT_SCHEDULE_INTERVAL_MS = '20'; // override só de teste — não espera 1h de verdade
    fresh('../lib/config');
    const independentAudit = fresh('../lib/independentAudit');
    let calls = 0;
    independentAudit.runIndependentAudit = async () => {
      calls += 1;
      return { findings: [], tools: {}, summary: 'nenhum achado', finishedAt: new Date().toISOString() };
    };

    const broadcasts = [];
    activeScheduler = fresh('../lib/auditScheduler');
    activeScheduler.startAuditScheduler({ broadcast: (event, data) => broadcasts.push({ event, data }) });

    await new Promise((r) => setTimeout(r, 90));
    assert.ok(calls >= 2, `esperava pelo menos 2 disparos em 90ms com intervalo de 20ms, teve ${calls}`);
    assert.ok(broadcasts.some((b) => b.event === 'audit-started' && b.data.scheduled === true));
    assert.ok(broadcasts.some((b) => b.event === 'audit-finished' && b.data.scheduled === true));

    const runs = independentAudit.auditRuns.list(10);
    assert.ok(runs.some((r) => r.status === 'completed'));
  });

  it('chamar startAuditScheduler duas vezes não duplica o intervalo', async () => {
    process.env.FORJA_AUDIT_SCHEDULE_HOURS = '1';
    process.env.FORJA_AUDIT_SCHEDULE_INTERVAL_MS = '20';
    fresh('../lib/config');
    const independentAudit = fresh('../lib/independentAudit');
    let calls = 0;
    independentAudit.runIndependentAudit = async () => {
      calls += 1;
      return { findings: [], tools: {}, summary: 'x', finishedAt: new Date().toISOString() };
    };

    activeScheduler = fresh('../lib/auditScheduler');
    const orch = { broadcast: () => {} };
    activeScheduler.startAuditScheduler(orch);
    activeScheduler.startAuditScheduler(orch); // segunda chamada — não deveria criar um segundo timer

    await new Promise((r) => setTimeout(r, 50));
    // Com 1 timer de 20ms por ~50ms, esperamos ~2 disparos; com 2 timers duplicados, seriam ~4.
    assert.ok(calls <= 3, `esperava no máximo 3 disparos (timer único), teve ${calls} — sinal de timer duplicado`);
  });
});
