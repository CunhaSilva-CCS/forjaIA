/**
 * Testa a costura mais frágil do orchestrator: um estágio persiste estado (via pauseForApproval /
 * persistTask) e, depois de um restart de verdade do processo, restorePendingApproval() precisa
 * reconstruir currentTask/savedConfig com os MESMOS dados — não uma aproximação.
 *
 * Achado real que motivou este arquivo: `deployTargets` (simulatorUdid/bundleId do deploy mobile,
 * ver ADR-018/029) já existia há tempo no resultado do deploy, mas nunca era persistido nem
 * restaurado — só descobri isso implementando o teste humano mobile, quase por acidente. Um teste
 * de restart sistemático, rodado contra o Orchestrator DE VERDADE (não uma versão fake), teria
 * pego isso sem precisar de dogfooding manual.
 *
 * Cada teste aqui: (1) roda um estágio real contra um Orchestrator real ligado a um SQLite
 * temporário de verdade, deixando ele pausar pra aprovação (o que persiste de verdade); (2)
 * instancia um SEGUNDO Orchestrator apontando pro MESMO banco — o construtor dele chama
 * restorePendingApproval() de verdade; (3) compara o estado antes/depois do "restart".
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'restart-safety-test-token-24ch';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-restart-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-restart-${Date.now()}.db`);

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

/** Cria uma run "em andamento" de verdade no banco — ponto de partida realista pra cada teste. */
function seedRun(db, { files } = {}) {
  const run = db.runs.create({ prompt: 'restart safety test', config: {} });
  db.runs.update(run.id, { status: 'coder', files: files || [{ path: 'a.js', content: 'x' }] });
  return run.id;
}

/** Simula "o processo reiniciou": um Orchestrator novo, mesmo banco, restorePendingApproval real. */
function restart() {
  const Orchestrator = fresh('../agent/orchestrator');
  return new Orchestrator(null);
}

describe('Restart safety — deployStage → humanStage (achado real que motivou este arquivo)', () => {
  it('deployTargets (simulatorUdid/bundleId) sobrevive a um restart no gate deploy→human', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = seedRun(db);
    orch.currentTask = { id: runId, status: 'devops', files: [{ path: 'a.js', content: 'x' }] };
    orch.savedConfig = {};

    const devops = fresh('../agent/devops');
    const original = devops.deploy;
    devops.deploy = async () => ({
      url: null,
      targets: [{ platform: 'ios-simulator', ok: true, simulatorUdid: 'UDID-LIVE', bundleId: 'com.forja.demo' }]
    });
    try {
      const deployStage = fresh('../agent/stages/deployStage');
      await deployStage.run(orch, {});
    } finally {
      devops.deploy = original;
    }

    assert.equal(orch.currentTask.status, 'awaiting_approval');
    assert.equal(orch.currentTask.pendingNextStage, 'human');
    assert.deepEqual(orch.currentTask.deployTargets, [
      { platform: 'ios-simulator', ok: true, simulatorUdid: 'UDID-LIVE', bundleId: 'com.forja.demo' }
    ]);

    const restarted = restart();
    assert.equal(restarted.currentTask.id, runId);
    assert.equal(restarted.currentTask.pendingNextStage, 'human');
    assert.deepEqual(
      restarted.currentTask.deployTargets,
      orch.currentTask.deployTargets,
      'deployTargets precisa sobreviver ao restart — humanStage.js lê isso pra saber qual Simulador/app abrir'
    );
  });
});

describe('Restart safety — humanStage (web, achados) → userFix', () => {
  it('humanReport (com issues) e pendingNextStage=userFix sobrevivem a um restart', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = seedRun(db);
    orch.currentTask = { id: runId, status: 'human', files: [{ path: 'a.js', content: 'x' }], deployUrl: 'http://127.0.0.1:5100' };
    orch.savedConfig = {};

    const human = fresh('../agent/human');
    const originalExecute = human.execute;
    const originalMobile = fresh('../lib/browserCheck').checkPlaywrightAvailable;
    human.execute = async () => ({
      passed: false,
      issues: [{ id: 'UX-BLANK-PAGE', severity: 'CRITICAL' }]
    });
    try {
      const humanStage = fresh('../agent/stages/humanStage');
      await humanStage.run(orch, {});
    } finally {
      human.execute = originalExecute;
      void originalMobile;
    }

    assert.equal(orch.currentTask.pendingNextStage, 'userFix');
    assert.equal(orch.currentTask.humanReport.passed, false);
    assert.equal(orch.currentTask.humanReport.issues.length, 1);

    const restarted = restart();
    assert.equal(restarted.currentTask.pendingNextStage, 'userFix');
    assert.deepEqual(
      restarted.currentTask.humanReport,
      orch.currentTask.humanReport,
      'humanReport completo (issues incluídas) precisa sobreviver — é o que prodReadyStage/reportStage leem depois'
    );
  });
});

describe('Restart safety — healerStage (contador de tentativas)', () => {
  it('healingAttempts sobrevive a um restart no meio de rodadas de cura', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = seedRun(db);
    orch.currentTask = { id: runId, status: 'healer', files: [{ path: 'a.js', content: 'x' }] };
    orch.savedConfig = {};
    orch.healingAttempts = 1;
    orch.maxHealingAttempts = 3;
    orch.lastTestReport = { tests: [{ name: 't', passed: false }], passed: false };
    orch.lastSecurityReport = { issues: [], passed: true };
    orch.lastDiagnosis = { rootCause: 'x' };

    const healer = fresh('../agent/healer');
    const original = healer.execute;
    healer.execute = async (files) => files;
    try {
      const healerStage = fresh('../agent/stages/healerStage');
      await healerStage.run(orch, {});
    } finally {
      healer.execute = original;
    }

    assert.equal(orch.healingAttempts, 2);

    const restarted = restart();
    assert.equal(
      restarted.healingAttempts,
      2,
      'healingAttempts precisa sobreviver — sem isso o teto de tentativas (ADR-013) reseta sozinho a cada restart'
    );
  });
});

describe('Restart safety — userFixStage (contador de tentativas + flag de intervenção)', () => {
  it('userFixAttempts e userFixInvoked sobrevivem a um restart', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = seedRun(db);
    orch.currentTask = {
      id: runId,
      status: 'userFix',
      files: [{ path: 'a.js', content: 'x' }],
      humanReport: { passed: false, issues: [] }
    };
    // userFixInvoked=true no savedConfig espelha o que queueUserReport() já teria persistido antes
    // de chegar aqui (userFixStage só é alcançado via relato do usuário) — sem isso no seed, o
    // teste mediria um cenário que a run real nunca produz.
    orch.savedConfig = { userReport: 'botão quebrado', userFixInvoked: true };
    orch.userFixAttempts = 1;
    orch.maxUserFixAttemptsBeforeEscalate = 3;
    orch.userFixInvoked = true;

    const userFix = fresh('../agent/userFix');
    const original = userFix.execute;
    userFix.execute = async (files) => files;
    try {
      const userFixStage = fresh('../agent/stages/userFixStage');
      await userFixStage.run(orch, {});
    } finally {
      userFix.execute = original;
    }

    assert.equal(orch.userFixAttempts, 2);

    const restarted = restart();
    assert.equal(restarted.userFixAttempts, 2, 'userFixAttempts precisa sobreviver — senão a escalada de provedor (ADR-026) nunca dispara depois de um restart');
    assert.equal(restarted.userFixInvoked, true, 'userFixInvoked precisa sobreviver — senão a run conta errado nas estatísticas de confiabilidade (ADR-012)');
  });
});

describe('Restart safety — debuggerStage (diagnóstico)', () => {
  it('lastDiagnosis sobrevive a um restart no gate debugger→healer', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = seedRun(db);
    orch.currentTask = { id: runId, status: 'debugger', files: [{ path: 'a.js', content: 'x' }] };
    orch.savedConfig = {};
    orch.lastTestReport = { tests: [{ name: 't', passed: false }], passed: false };
    orch.lastSecurityReport = { issues: [], passed: true };

    const debuggerAgent = fresh('../agent/debugger');
    const original = debuggerAgent.execute;
    debuggerAgent.execute = async () => ({ rootCause: 'null pointer', suggestedFix: 'checar antes de usar' });
    try {
      const debuggerStage = fresh('../agent/stages/debuggerStage');
      await debuggerStage.run(orch, {});
    } finally {
      debuggerAgent.execute = original;
    }

    assert.equal(orch.currentTask.pendingNextStage, 'healer');
    assert.equal(orch.lastDiagnosis.rootCause, 'null pointer');

    const restarted = restart();
    assert.equal(restarted.currentTask.pendingNextStage, 'healer');
    assert.deepEqual(
      restarted.lastDiagnosis,
      orch.lastDiagnosis,
      'lastDiagnosis precisa sobreviver — healerStage lê isso pra saber o que corrigir'
    );
  });
});

describe('Restart safety — orchestrator.run() (arquiteto → coder, o PRIMEIRO gate da run)', () => {
  it('savedPlan (files/adrs planejados) e adrs sobrevivem a um restart antes da aprovação do coder', async () => {
    fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    // O construtor já rodou restorePendingApproval() e pode ter pego uma run "awaiting_approval"
    // deixada por outro teste deste arquivo (banco compartilhado) — irrelevante pro que este teste
    // verifica, então começa limpo.
    orch.currentTask = null;

    const architect = fresh('../agent/architect');
    const original = architect.execute;
    architect.execute = async () => ({
      files: [{ name: 'a.js', path: 'a.js' }, { name: 'b.js', path: 'b.js' }],
      adrs: [{ id: 'ADR-001', title: 'Decisão de teste', status: 'Aprovado', context: 'x', decision: 'y', consequences: 'z' }]
    });
    try {
      await orch.run('construa um crud simples', {});
    } finally {
      architect.execute = original;
    }

    assert.equal(orch.currentTask.pendingNextStage, 'coder');
    assert.equal(orch.currentTask.adrs.length, 1);

    const runId = orch.currentTask.id;
    const restarted = restart();
    assert.equal(restarted.currentTask.id, runId);
    assert.equal(restarted.currentTask.pendingNextStage, 'coder');
    assert.equal(
      restarted.savedPlan?.files?.length,
      2,
      'savedPlan.files precisa sobreviver — coderStage usa isso pra saber o que gerar'
    );
    assert.deepEqual(restarted.currentTask.adrs, orch.currentTask.adrs);
    assert.equal(restarted.savedPrompt, orch.savedPrompt);
  });
});

describe('Restart safety — qaStage → securityStage', () => {
  it('lastTestReport (reconstruído a partir de currentTask.tests) mantém o mesmo veredito de "passed" após um restart', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = seedRun(db);
    orch.currentTask = { id: runId, status: 'qa', files: [{ path: 'a.js', content: 'x' }], tests: [] };
    orch.savedConfig = {};

    const qa = fresh('../agent/qa');
    const original = qa.execute;
    qa.execute = async () => ({
      passed: false,
      tests: [
        { name: 'soma dois números', passed: true },
        { name: 'rejeita entrada inválida', passed: false, error: 'esperava 400, veio 500' }
      ]
    });
    try {
      const qaStage = fresh('../agent/stages/qaStage');
      await qaStage.run(orch, {});
    } finally {
      qa.execute = original;
    }

    assert.equal(orch.currentTask.pendingNextStage, 'security');
    assert.equal(orch.lastTestReport.passed, false);

    const restarted = restart();
    assert.equal(restarted.currentTask.pendingNextStage, 'security');
    assert.equal(restarted.currentTask.tests.length, 2);
    assert.equal(
      restarted.lastTestReport.passed,
      false,
      'securityStage lê lastTestReport.passed pra decidir se precisa curar — precisa bater com o veredito real do QA, não um recálculo diferente'
    );
  });
});

describe('Restart safety — securityStage → devops', () => {
  it('lastSecurityReport (reconstruído a partir de currentTask.securityIssues) sobrevive a um restart', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = seedRun(db);
    orch.currentTask = { id: runId, status: 'security', files: [{ path: 'a.js', content: 'x' }], tests: [] };
    orch.savedConfig = {};
    orch.lastTestReport = { tests: [], passed: true };
    orch.healingAttempts = 0;
    orch.maxHealingAttempts = 3;

    const security = fresh('../agent/security');
    const original = security.execute;
    security.execute = async () => ({
      passed: false,
      issues: [{ id: 'SEC-1', severity: 'HIGH', title: 'segredo hardcoded', description: 'x' }]
    });
    try {
      const securityStage = fresh('../agent/stages/securityStage');
      await securityStage.run(orch, {});
    } finally {
      security.execute = original;
    }

    // segurança falhou e ainda há tentativas de cura → vai pro debugger, não direto pro devops
    assert.equal(orch.currentTask.pendingNextStage, 'debugger');
    assert.equal(orch.lastSecurityReport.issues.length, 1);

    const restarted = restart();
    assert.equal(restarted.currentTask.pendingNextStage, 'debugger');
    assert.equal(restarted.currentTask.securityIssues.length, 1);
    assert.equal(
      restarted.lastSecurityReport.issues.length,
      1,
      'debuggerStage lê lastSecurityReport pra diagnosticar — precisa sobreviver ao restart'
    );
  });
});

describe('Restart safety — prodReadyStage (sucesso) → report', () => {
  it('productionReady, gitBranch e prUrl sobrevivem a um restart no gate prodReady→report', async () => {
    const db = fresh('../lib/db');
    const Orchestrator = fresh('../agent/orchestrator');
    const orch = new Orchestrator(null);
    const runId = seedRun(db);
    orch.currentTask = {
      id: runId,
      status: 'prodReady',
      files: [{ path: 'a.js', content: 'x' }],
      deployUrl: 'http://127.0.0.1:5100'
    };
    orch.savedConfig = { targetPath: 'deployed' };
    orch.savedPrompt = 'construa um crud simples';

    const productionChecklist = fresh('../lib/productionChecklist');
    const originalEval = productionChecklist.evaluateProductionReady;
    const gitRelease = fresh('../lib/gitRelease');
    const originalPublish = gitRelease.publishRelease;
    productionChecklist.evaluateProductionReady = async () => ({
      ready: true,
      summary: 'tudo ok',
      checks: [{ ok: true, title: 'lint', detail: 'sem erros' }],
      artifactsWritten: []
    });
    gitRelease.publishRelease = async () => ({ branch: 'forja/run-x', prUrl: 'https://github.com/x/y/pull/1' });
    try {
      const prodReadyStage = fresh('../agent/stages/prodReadyStage');
      await prodReadyStage.run(orch, {});
    } finally {
      productionChecklist.evaluateProductionReady = originalEval;
      gitRelease.publishRelease = originalPublish;
    }

    assert.equal(orch.currentTask.pendingNextStage, 'report');
    assert.equal(orch.currentTask.productionReady.ready, true);
    assert.equal(orch.savedConfig.gitBranch, 'forja/run-x');

    const restarted = restart();
    assert.equal(restarted.currentTask.pendingNextStage, 'report');
    // productionReady só tem fallback pro savedConfig no ponto de leitura (emitReportPdf), não
    // restauração explícita em currentTask — confirma que esse fallback funciona de verdade.
    const productionReady =
      restarted.currentTask.productionReady || restarted.savedConfig?.productionReady || restarted.savedConfig?.lastProductionReady;
    assert.equal(productionReady?.ready, true, 'productionReady precisa sobreviver (via savedConfig) — reportStage e o PDF final leem isso');
    assert.equal(restarted.savedConfig.gitBranch, 'forja/run-x');
    assert.equal(restarted.savedConfig.prUrl, 'https://github.com/x/y/pull/1');
  });
});
