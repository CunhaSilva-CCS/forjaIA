const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'stages-test-token-with-24-chars';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-stages-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-stages-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3096';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

/**
 * Fake orchestrator with just enough surface for the stage modules under test.
 * pauseCalls/logs/broadcasts/persisted let assertions inspect what a stage did
 * without depending on the real Orchestrator class or its persistence layer.
 */
function makeOrchestrator(patch = {}) {
  const pauseCalls = [];
  const logs = [];
  const broadcasts = [];
  const persisted = [];
  const orch = {
    currentTask: { id: 'fake-run', files: [], tests: [], securityIssues: [] },
    savedConfig: {},
    savedPrompt: 'construa um crud simples',
    savedPlan: { files: [{ name: 'a.js', path: 'a.js' }], adrs: [] },
    healingAttempts: 0,
    maxHealingAttempts: 3,
    lastTestReport: null,
    lastSecurityReport: null,
    lastDiagnosis: null,
    fileVersionCounters: {},
    isExecuting: true,
    throwIfAborted() {},
    broadcast(event, data) {
      broadcasts.push({ event, data });
    },
    log(agent, message, type) {
      logs.push({ agent, message, type });
    },
    persistTask(p) {
      persisted.push(p);
      Object.assign(orch.currentTask, p);
    },
    saveFileVersions() {},
    writeFilesToWorkspace() {},
    async emitReportPdf() {
      return true;
    },
    async promoteQueue() {
      orch.promoted = true;
    },
    async pauseForApproval(nextStage, message) {
      pauseCalls.push({ nextStage, message });
      orch.currentTask.status = 'awaiting_approval';
      orch.currentTask.pendingNextStage = nextStage;
    },
    ...patch
  };
  orch.pauseCalls = pauseCalls;
  orch.logs = logs;
  orch.broadcasts = broadcasts;
  orch.persisted = persisted;
  return orch;
}

describe('coderStage', () => {
  it('grava os arquivos gerados e pausa em qa', async () => {
    const coder = fresh('../agent/coder');
    const original = coder.execute;
    coder.execute = async () => ({ files: [{ path: 'a.js', content: 'console.log(1)' }] });
    try {
      const stage = fresh('../agent/stages/coderStage');
      const orch = makeOrchestrator();
      await stage.run(orch, {});
      assert.deepEqual(orch.currentTask.files, [{ path: 'a.js', content: 'console.log(1)' }]);
      assert.equal(orch.pauseCalls.length, 1);
      assert.equal(orch.pauseCalls[0].nextStage, 'qa');
    } finally {
      coder.execute = original;
    }
  });

  it('não chama o coder quando a execução já foi abortada', async () => {
    const coder = fresh('../agent/coder');
    const original = coder.execute;
    let called = false;
    coder.execute = async () => {
      called = true;
      return { files: [] };
    };
    try {
      const stage = fresh('../agent/stages/coderStage');
      const orch = makeOrchestrator({
        throwIfAborted() {
          throw Object.assign(new Error('Execução cancelada pelo usuário'), { cancelled: true });
        }
      });
      await assert.rejects(() => stage.run(orch, {}), /cancelada/i);
      assert.equal(called, false);
    } finally {
      coder.execute = original;
    }
  });
});

describe('qaStage', () => {
  it('executa a suíte de QA e pausa em security', async () => {
    const qa = fresh('../agent/qa');
    const original = qa.execute;
    const report = { passed: true, tests: [{ name: 'smoke', passed: true }] };
    qa.execute = async () => report;
    try {
      const stage = fresh('../agent/stages/qaStage');
      const orch = makeOrchestrator();
      await stage.run(orch, {});
      assert.equal(orch.lastTestReport, report);
      assert.deepEqual(orch.currentTask.tests, report.tests);
      assert.equal(orch.pauseCalls[0].nextStage, 'security');
    } finally {
      qa.execute = original;
    }
  });
});

describe('securityStage', () => {
  it('pausa em debugger quando há falhas e ainda há tentativas de cura', async () => {
    const security = fresh('../agent/security');
    const original = security.execute;
    security.execute = async () => ({ passed: false, issues: [{ severity: 'HIGH' }] });
    try {
      const stage = fresh('../agent/stages/securityStage');
      const orch = makeOrchestrator({
        lastTestReport: { tests: [{ name: 't', passed: false }], passed: false },
        healingAttempts: 0,
        maxHealingAttempts: 3
      });
      await stage.run(orch, {});
      assert.equal(orch.pauseCalls[0].nextStage, 'debugger');
    } finally {
      security.execute = original;
    }
  });

  it('pausa em devops quando tudo passa', async () => {
    const security = fresh('../agent/security');
    const original = security.execute;
    security.execute = async () => ({ passed: true, issues: [] });
    try {
      const stage = fresh('../agent/stages/securityStage');
      const orch = makeOrchestrator({
        lastTestReport: { tests: [{ name: 't', passed: true }], passed: true }
      });
      await stage.run(orch, {});
      assert.equal(orch.pauseCalls[0].nextStage, 'devops');
      assert.ok(orch.logs.some((l) => l.type === 'success'));
    } finally {
      security.execute = original;
    }
  });

  it('segue com ressalvas para devops quando o máximo de curas foi atingido', async () => {
    const security = fresh('../agent/security');
    const original = security.execute;
    security.execute = async () => ({ passed: false, issues: [{ severity: 'LOW' }] });
    try {
      const stage = fresh('../agent/stages/securityStage');
      const orch = makeOrchestrator({
        lastTestReport: { tests: [{ name: 't', passed: false }], passed: false },
        healingAttempts: 3,
        maxHealingAttempts: 3
      });
      await stage.run(orch, {});
      assert.equal(orch.pauseCalls[0].nextStage, 'devops');
      assert.ok(orch.logs.some((l) => l.type === 'warning' && /ressalvas/i.test(l.message)));
    } finally {
      security.execute = original;
    }
  });
});

describe('debuggerStage', () => {
  it('registra o diagnóstico e pausa em healer', async () => {
    const debuggerAgent = fresh('../agent/debugger');
    const original = debuggerAgent.execute;
    const diagnosis = { severity: 'alta', hypotheses: ['x'] };
    debuggerAgent.execute = async () => diagnosis;
    try {
      const { runs } = fresh('../lib/db');
      const row = runs.create({ prompt: 'debug me', config: {} });
      const stage = fresh('../agent/stages/debuggerStage');
      const orch = makeOrchestrator({ currentTask: { id: row.id, files: [], tests: [], securityIssues: [] } });
      await stage.run(orch, {});
      assert.equal(orch.lastDiagnosis, diagnosis);
      assert.equal(orch.currentTask.diagnosis, diagnosis);
      assert.equal(orch.pauseCalls[0].nextStage, 'healer');
      assert.match(orch.pauseCalls[0].message, /alta/);
    } finally {
      debuggerAgent.execute = original;
    }
  });
});

describe('healerStage', () => {
  it('aplica a cura, incrementa healingAttempts e pausa em qa', async () => {
    const healer = fresh('../agent/healer');
    const original = healer.execute;
    const healedFiles = [{ path: 'a.js', content: 'fixed' }];
    healer.execute = async () => healedFiles;
    try {
      const stage = fresh('../agent/stages/healerStage');
      const orch = makeOrchestrator({ healingAttempts: 0 });
      await stage.run(orch, {});
      assert.equal(orch.healingAttempts, 1);
      assert.deepEqual(orch.currentTask.files, healedFiles);
      assert.equal(orch.pauseCalls[0].nextStage, 'qa');
    } finally {
      healer.execute = original;
    }
  });

  it('quando o curador falha, incrementa healingAttempts e pausa em healer para nova tentativa', async () => {
    const healer = fresh('../agent/healer');
    const original = healer.execute;
    healer.execute = async () => {
      throw new Error('llm indisponível');
    };
    try {
      const stage = fresh('../agent/stages/healerStage');
      const orch = makeOrchestrator({ healingAttempts: 0 });
      await stage.run(orch, {});
      // Falha também conta pro limite — senão uma sequência de falhas nunca bate o teto
      // e fica pedindo pra tentar de novo pra sempre.
      assert.equal(orch.healingAttempts, 1);
      assert.equal(orch.pauseCalls[0].nextStage, 'healer');
      assert.match(orch.pauseCalls[0].message, /llm indisponível/);
    } finally {
      healer.execute = original;
    }
  });

  it('quando o curador falha e já bateu o limite de tentativas, segue para devops em vez de repetir', async () => {
    const healer = fresh('../agent/healer');
    const original = healer.execute;
    healer.execute = async () => {
      throw new Error('llm indisponível');
    };
    try {
      const stage = fresh('../agent/stages/healerStage');
      const orch = makeOrchestrator({ healingAttempts: 2, maxHealingAttempts: 3 });
      await stage.run(orch, {});
      assert.equal(orch.healingAttempts, 3);
      assert.equal(orch.pauseCalls[0].nextStage, 'devops');
      assert.match(orch.pauseCalls[0].message, /limite de tentativas/i);
    } finally {
      healer.execute = original;
    }
  });

  it('não escala provedor em tentativas normais (ADR-013)', async () => {
    const healer = fresh('../agent/healer');
    const original = healer.execute;
    let capturedRunConfig = null;
    healer.execute = async (files, tests, security, runConfig) => {
      capturedRunConfig = runConfig;
      return [{ path: 'a.js', content: 'fixed' }];
    };
    try {
      const stage = fresh('../agent/stages/healerStage');
      const orch = makeOrchestrator({ healingAttempts: 0, maxHealingAttempts: 3 });
      await stage.run(orch, {});
      assert.equal(capturedRunConfig.escalateProvider, false);
    } finally {
      healer.execute = original;
    }
  });

  it('escala provedor na última tentativa antes do teto (ADR-013)', async () => {
    const healer = fresh('../agent/healer');
    const original = healer.execute;
    let capturedRunConfig = null;
    healer.execute = async (files, tests, security, runConfig) => {
      capturedRunConfig = runConfig;
      return [{ path: 'a.js', content: 'fixed' }];
    };
    try {
      const stage = fresh('../agent/stages/healerStage');
      // healingAttempts=2, maxHealingAttempts=3 → esta é a tentativa #3, a última.
      const orch = makeOrchestrator({ healingAttempts: 2, maxHealingAttempts: 3 });
      await stage.run(orch, {});
      assert.equal(capturedRunConfig.escalateProvider, true);
    } finally {
      healer.execute = original;
    }
  });
});

describe('devopsLoadStage', () => {
  it('roda carga+caos na sandbox e pausa em deploy', async () => {
    const devops = fresh('../agent/devops');
    const loadTester = fresh('../sandbox/load_tester');
    const chaos = fresh('../sandbox/chaos');
    const originals = {
      prepareSandbox: devops.prepareSandbox,
      cleanupSandbox: devops.cleanupSandbox,
      run: loadTester.run,
      start: chaos.start,
      stop: chaos.stop
    };
    devops.prepareSandbox = async () => ({ baseUrl: 'http://127.0.0.1:1' });
    devops.cleanupSandbox = async () => {};
    let chaosStarted = false;
    let chaosStopped = false;
    chaos.start = () => {
      chaosStarted = true;
    };
    chaos.stop = () => {
      chaosStopped = true;
    };
    loadTester.run = async () => ({ totalRequests: 50, avgLatency: 12, successRate: 98 });
    try {
      const stage = fresh('../agent/stages/devopsLoadStage');
      const orch = makeOrchestrator();
      await stage.run(orch, {});
      assert.ok(chaosStarted && chaosStopped);
      assert.deepEqual(orch.currentTask.performanceMetrics, {
        totalRequests: 50,
        avgLatency: 12,
        successRate: 98
      });
      assert.equal(orch.pauseCalls[0].nextStage, 'deploy');
    } finally {
      Object.assign(devops, { prepareSandbox: originals.prepareSandbox, cleanupSandbox: originals.cleanupSandbox });
      loadTester.run = originals.run;
      chaos.start = originals.start;
      chaos.stop = originals.stop;
    }
  });

  it('pula carga/caos e vai direto pro deploy em projeto mobile (ADR-014)', async () => {
    const devops = fresh('../agent/devops');
    const original = devops.prepareSandbox;
    let sandboxCalled = false;
    devops.prepareSandbox = async () => {
      sandboxCalled = true;
      return {};
    };
    try {
      const stage = fresh('../agent/stages/devopsLoadStage');
      const mobilePkg = JSON.stringify({ dependencies: { expo: '^57.0.0' } });
      const orch = makeOrchestrator({
        currentTask: { id: 'fake-run', files: [{ path: 'package.json', content: mobilePkg }], tests: [], securityIssues: [] }
      });
      await stage.run(orch, {});
      assert.equal(sandboxCalled, false);
      assert.equal(orch.pauseCalls[0].nextStage, 'deploy');
    } finally {
      devops.prepareSandbox = original;
    }
  });
});

describe('deployStage', () => {
  it('publica o deploy e pausa em human', async () => {
    const devops = fresh('../agent/devops');
    const original = devops.deploy;
    devops.deploy = async () => ({ url: 'http://127.0.0.1:4000' });
    try {
      const stage = fresh('../agent/stages/deployStage');
      const orch = makeOrchestrator();
      await stage.run(orch, {});
      assert.equal(orch.currentTask.deployUrl, 'http://127.0.0.1:4000');
      assert.equal(orch.pauseCalls[0].nextStage, 'human');
    } finally {
      devops.deploy = original;
    }
  });
});

describe('humanStage', () => {
  it('quando o teste humano passa, pausa em prodReady', async () => {
    const human = fresh('../agent/human');
    const original = human.execute;
    human.execute = async () => ({ passed: true, issues: [] });
    try {
      const stage = fresh('../agent/stages/humanStage');
      const orch = makeOrchestrator();
      await stage.run(orch, {});
      assert.equal(orch.pauseCalls[0].nextStage, 'prodReady');
    } finally {
      human.execute = original;
    }
  });

  it('quando o teste humano encontra problemas, pausa em userFix', async () => {
    const human = fresh('../agent/human');
    const original = human.execute;
    human.execute = async () => ({ passed: false, issues: [{ id: 1 }, { id: 2 }] });
    try {
      const stage = fresh('../agent/stages/humanStage');
      const orch = makeOrchestrator();
      await stage.run(orch, {});
      assert.equal(orch.pauseCalls[0].nextStage, 'userFix');
      assert.match(orch.pauseCalls[0].message, /2 problema/);
    } finally {
      human.execute = original;
    }
  });

  it('pula teste humano via HTTP e pausa em prodReady em projeto mobile (ADR-014)', async () => {
    const human = fresh('../agent/human');
    let humanExecuteCalled = false;
    const original = human.execute;
    human.execute = async () => {
      humanExecuteCalled = true;
      return { passed: true, issues: [] };
    };
    try {
      const stage = fresh('../agent/stages/humanStage');
      const mobilePkg = JSON.stringify({ dependencies: { expo: '^57.0.0' } });
      const orch = makeOrchestrator({
        currentTask: { id: 'fake-run', files: [{ path: 'package.json', content: mobilePkg }], tests: [], securityIssues: [] }
      });
      await stage.run(orch, {});
      assert.equal(humanExecuteCalled, false);
      assert.equal(orch.currentTask.humanReport.skipped, true);
      assert.equal(orch.pauseCalls[0].nextStage, 'prodReady');
    } finally {
      human.execute = original;
    }
  });
});

describe('prodReadyStage', () => {
  it('quando o checklist passa, publica release e pausa em report', async () => {
    const checklist = fresh('../lib/productionChecklist');
    const gitRelease = fresh('../lib/gitRelease');
    const originalEval = checklist.evaluateProductionReady;
    const originalPublish = gitRelease.publishRelease;
    checklist.evaluateProductionReady = async () => ({
      ready: true,
      summary: 'Tudo pronto para produção.',
      checks: [{ id: 'qa-green', ok: true, title: 'QA', detail: 'ok' }],
      artifactsWritten: []
    });
    gitRelease.publishRelease = async () => ({ branch: null, prUrl: null });
    try {
      const stage = fresh('../agent/stages/prodReadyStage');
      const orch = makeOrchestrator();
      await stage.run(orch, { targetPath: 'demo-app' });
      assert.equal(orch.currentTask.productionReady.ready, true);
      assert.equal(orch.pauseCalls[0].nextStage, 'report');
    } finally {
      checklist.evaluateProductionReady = originalEval;
      gitRelease.publishRelease = originalPublish;
    }
  });

  it('quando o checklist falha, pausa em userFix com o motivo registrado', async () => {
    const checklist = fresh('../lib/productionChecklist');
    const originalEval = checklist.evaluateProductionReady;
    checklist.evaluateProductionReady = async () => ({
      ready: false,
      summary: 'Faltam gates de segurança.',
      checks: [{ id: 'security-clean', ok: false, title: 'Segurança', detail: 'HIGH encontrado' }],
      issues: [{ severity: 'HIGH', title: 'XSS', description: 'input não sanitizado' }]
    });
    try {
      const stage = fresh('../agent/stages/prodReadyStage');
      const orch = makeOrchestrator();
      await stage.run(orch, { targetPath: 'demo-app' });
      assert.equal(orch.pauseCalls[0].nextStage, 'userFix');
      assert.match(orch.savedConfig.userReport, /HIGH.*XSS/s);
    } finally {
      checklist.evaluateProductionReady = originalEval;
    }
  });
});

describe('userFixStage', () => {
  it('aplica a correção do relato humano e pausa em qa', async () => {
    const userFix = fresh('../agent/userFix');
    const original = userFix.execute;
    const fixedFiles = [{ path: 'a.js', content: 'corrigido' }];
    userFix.execute = async () => fixedFiles;
    try {
      const stage = fresh('../agent/stages/userFixStage');
      const orch = makeOrchestrator();
      await stage.run(orch, {});
      assert.deepEqual(orch.currentTask.files, fixedFiles);
      assert.equal(orch.pauseCalls[0].nextStage, 'qa');
    } finally {
      userFix.execute = original;
    }
  });

  it('quando o corretor falha, pausa em userFix para nova tentativa', async () => {
    const userFix = fresh('../agent/userFix');
    const original = userFix.execute;
    userFix.execute = async () => {
      throw new Error('sem contexto suficiente');
    };
    try {
      const stage = fresh('../agent/stages/userFixStage');
      const orch = makeOrchestrator();
      await stage.run(orch, {});
      assert.equal(orch.pauseCalls[0].nextStage, 'userFix');
      assert.match(orch.pauseCalls[0].message, /sem contexto suficiente/);
    } finally {
      userFix.execute = original;
    }
  });
});

describe('reportStage', () => {
  it('bloqueia o relatório final se o checklist de produção não passou', async () => {
    const stage = fresh('../agent/stages/reportStage');
    const orch = makeOrchestrator({ currentTask: { id: 'r1', productionReady: { ready: false } } });
    await assert.rejects(() => stage.run(orch), /checklist de produção não aprovado/i);
  });

  it('gera o PDF e conclui a execução quando o checklist passou', async () => {
    const stage = fresh('../agent/stages/reportStage');
    const orch = makeOrchestrator({
      currentTask: { id: 'r1', productionReady: { ready: true }, deployUrl: 'http://x' }
    });
    await stage.run(orch);
    assert.equal(orch.currentTask.status, 'completed');
    assert.equal(orch.promoted, true);
    assert.ok(orch.broadcasts.some((b) => b.event === 'task-completed'));
  });

  it('propaga erro se a geração do PDF falhar', async () => {
    const stage = fresh('../agent/stages/reportStage');
    const orch = makeOrchestrator({
      currentTask: { id: 'r1', productionReady: { ready: true } },
      async emitReportPdf() {
        return false;
      }
    });
    await assert.rejects(() => stage.run(orch), /falha ao gerar o relatório pdf/i);
  });
});
