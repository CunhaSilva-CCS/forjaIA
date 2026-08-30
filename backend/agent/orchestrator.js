const EventEmitter = require('events');
const { runs } = require('../lib/db');
const config = require('../lib/config');

const STAGE_LABELS = {
  coder: 'Codificar',
  qa: 'Executar QA',
  security: 'Executar Segurança',
  debugger: 'Diagnosticar (Depurador)',
  healer: 'Curar código',
  devops: 'Carga e caos (DevOps)',
  deploy: 'Fazer deploy',
  human: 'Teste humano in loco (fluxo)',
  userFix: 'Corrigir erros do usuário',
  prodReady: 'Checklist de produção',
  report: 'Gerar relatório PDF'
};

/** Em validate, sourcePath é a verdade; targetPath stale da UI não deve vazar. */
function resolveRunTarget(config) {
  if (!config) return null;
  if (config.mode === 'validate' && config.sourcePath) return config.sourcePath;
  return config.targetPath || config.sourcePath || null;
}

function normalizeRunConfig(config) {
  if (!config || typeof config !== 'object') return config || {};
  const next = { ...config };
  const canonical = resolveRunTarget(next);
  if (canonical) {
    next.targetPath = canonical;
    if (next.mode === 'validate') next.sourcePath = canonical;
  }
  return next;
}

function emptyTokenStats() {
  return {
    prompt: 0,
    completion: 0,
    total: 0,
    calls: 0,
    peakPrompt: 0,
    peakCompletion: 0,
    peakTotal: 0,
    estimatedCostUsd: 0,
    last: null
  };
}

class Orchestrator extends EventEmitter {
  constructor(wsServer) {
    super();
    this.wsServer = wsServer;
    this.currentTask = null;
    this.isExecuting = false;
    this.savedConfig = null;
    this.savedPlan = null;
    this.savedPrompt = null;
    this.abortController = null;
    this.fileVersionCounters = {};
    this.healingAttempts = 0;
    this.userFixInvoked = false;
    this.maxHealingAttempts = 3;
    // Achado real (auditoria funcional ao vivo): userFix.js retentava indefinidamente com o
    // MESMO provedor sem nunca escalar — vi 4 falhas seguidas em Ollama local antes de acertar
    // na 5ª. Mesmo contador/escalada que o Curador já usa (ADR-013), agora espelhado aqui.
    this.userFixAttempts = 0;
    this.maxUserFixAttemptsBeforeEscalate = 3;
    this.lastTestReport = null;
    this.lastSecurityReport = null;
    this.lastDiagnosis = null;
    this.restorePendingApproval();
  }

  restorePendingApproval() {
    try {
      const row = runs.list(20).find((r) => r.status === 'awaiting_approval');
      if (!row) return;
      const plan = row.plan || { files: row.files || [], adrs: row.adrs || [] };
      if (!plan.files?.length && row.files?.length) {
        plan.files = row.files.map((f) => ({ name: f.name, path: f.path }));
      }
      const mode = row.config?.mode === 'validate' ? 'validate' : 'forge';
      const pendingNextStage =
        row.config?.pendingNextStage || (mode === 'validate' ? 'qa' : 'coder');
      this.currentTask = {
        id: row.id,
        prompt: row.prompt,
        status: 'awaiting_approval',
        pendingNextStage,
        approvalLabel: STAGE_LABELS[pendingNextStage] || pendingNextStage,
        approvalMessage: row.config?.interruptedByRestart
          ? `Processo reiniciado. Aprove para retomar: ${STAGE_LABELS[pendingNextStage] || pendingNextStage}.`
          : null,
        startTime: row.started_at,
        files: row.files || [],
        adrs: row.adrs || plan.adrs || [],
        tests: row.tests || [],
        securityIssues: row.securityIssues || [],
        diagnosis: row.config?.lastDiagnosis || null,
        performanceMetrics: row.performanceMetrics || null,
        tokenStats: row.tokenStats || emptyTokenStats(),
        config: row.config || {},
        deployUrl: row.deploy_url || null,
        error: null
      };
      this.savedConfig = normalizeRunConfig({ ...(row.config || {}), pendingNextStage });
      this.savedPlan = plan;
      this.savedPrompt = row.prompt;
      this.healingAttempts = Number(row.config?.healingAttempts || 0);
      this.userFixInvoked = Boolean(row.config?.userFixInvoked);
      this.userFixAttempts = Number(row.config?.userFixAttempts || 0);
      this.lastDiagnosis = row.config?.lastDiagnosis || null;
      this.currentTask.humanReport = row.config?.humanReport || row.config?.lastHumanReport || null;
      this.currentTask.deployTargets = row.config?.deployTargets || null;
      const tests = this.currentTask.tests || [];
      const securityIssues = this.currentTask.securityIssues || [];
      this.lastTestReport = {
        tests,
        passed: tests.length > 0 && tests.every((t) => t.passed)
      };
      this.lastSecurityReport = {
        issues: securityIssues,
        passed: securityIssues.length === 0
      };
      this.fileVersionCounters = {};
      try {
        for (const rowVer of runs.maxFileVersions(row.id) || []) {
          this.fileVersionCounters[rowVer.path] = Number(rowVer.max_version) || 0;
        }
      } catch {
        // ignore missing helper on older DBs
      }
      console.log(`[orchestrator] Execução ${row.id} restaurada; próxima etapa: ${pendingNextStage}`);
    } catch (err) {
      console.error('Falha ao restaurar execução pendente:', err.message);
    }
  }

  hasBlockingTask() {
    return Boolean(
      this.isExecuting || this.currentTask?.status === 'awaiting_approval'
    );
  }

  createAbortController() {
    this.abortController = new AbortController();
    return this.abortController;
  }

  getSignal() {
    return this.abortController?.signal;
  }

  throwIfAborted() {
    if (this.abortController?.signal?.aborted) {
      const err = new Error('Execução cancelada pelo usuário');
      err.cancelled = true;
      throw err;
    }
    // Chamado no início de toda etapa (mesmo checkpoint cooperativo do cancelamento acima) — é o
    // ponto confiável pra interromper por orçamento excedido (ver ADR-024/recordTokens). Sem
    // `.cancelled`, então cai no MESMO caminho de "etapa interrompida, aprove pra tentar de novo"
    // de qualquer outro erro de etapa — aprovar de novo é o próprio ato de autorizar gastar mais.
    if (this.currentTask?.budgetExceeded) {
      const budgetUsd = Number(this.savedConfig?.budgetUsd ?? config.runBudgetUsd ?? 0);
      const spent = this.currentTask.tokenStats?.estimatedCostUsd || 0;
      throw new Error(
        `Orçamento estimado de $${budgetUsd.toFixed(2)} excedido (gasto estimado: $${spent.toFixed(2)})`
      );
    }
  }

  broadcast(event, data) {
    const message = JSON.stringify({ event, data });
    if (this.wsServer) {
      this.wsServer.clients.forEach((client) => {
        if (client.readyState === 1) client.send(message);
      });
    }
    this.emit(event, data);
  }

  log(agent, message, type = 'info') {
    console.log(`[${agent.toUpperCase()}] [${type.toUpperCase()}] ${message}`);
    if (this.currentTask?.id) {
      try {
        runs.addEvent(this.currentTask.id, { agent, message, type });
      } catch (e) {
        console.error('Failed to persist log event', e);
      }
    }
    this.broadcast('agent-log', {
      agent,
      message,
      type,
      timestamp: new Date().toISOString(),
      runId: this.currentTask?.id || null
    });
  }

  recordTokens(tokens, meta = {}) {
    if (!tokens || !this.currentTask) return;
    const stats = this.currentTask.tokenStats || emptyTokenStats();
    const prompt = Number(tokens.prompt || 0);
    const completion = Number(tokens.completion || 0);
    const total = Number(tokens.total || prompt + completion);
    const provider = meta.provider || tokens.provider || null;
    const model = meta.model || tokens.model || null;

    stats.prompt += prompt;
    stats.completion += completion;
    stats.total += total;
    stats.calls = (stats.calls || 0) + 1;
    stats.peakPrompt = Math.max(stats.peakPrompt || 0, prompt);
    stats.peakCompletion = Math.max(stats.peakCompletion || 0, completion);
    stats.peakTotal = Math.max(stats.peakTotal || 0, total);
    stats.last = { prompt, completion, total, provider, model, at: new Date().toISOString() };

    // Teto de orçamento por run (ver ADR-024) — estimativa, não fatura real (nenhum provedor
    // expõe isso por API, ver ADR-017). Provedor desconhecido devolve `null` (não finge custo
    // zero nem soma um número inventado ao total).
    const { estimateCostUsd } = require('../lib/llmPricing');
    const delta = estimateCostUsd({ provider, model, promptTokens: prompt, completionTokens: completion });
    if (delta != null) stats.estimatedCostUsd = (stats.estimatedCostUsd || 0) + delta;

    this.currentTask.tokenStats = stats;
    runs.update(this.currentTask.id, { tokenStats: stats });
    this.broadcast('tokens-updated', stats);

    const budgetUsd = Number(this.savedConfig?.budgetUsd ?? config.runBudgetUsd ?? 0);
    if (budgetUsd > 0 && stats.estimatedCostUsd > budgetUsd) {
      // Não lança direto daqui — quem chama recordTokens (thinkAsSenior, etc.) às vezes engole
      // exceção própria num try/catch que trataria isso como "LLM indisponível", nunca chegando
      // no pauseForApproval do orchestrator. Marca um flag e deixa o throwIfAborted() — chamado
      // no início de toda etapa, o mesmo checkpoint cooperativo já usado pra cancelamento — ser o
      // ponto único e confiável que efetivamente interrompe a run.
      this.currentTask.budgetExceeded = true;
      this.log(
        'orchestrator',
        `Orçamento estimado de $${budgetUsd.toFixed(2)} excedido nesta run (gasto estimado: $${stats.estimatedCostUsd.toFixed(2)}). Pausando na próxima etapa.`,
        'warning'
      );
    }
  }

  persistTask(patch = {}) {
    if (!this.currentTask?.id) return;
    Object.assign(this.currentTask, patch);
    runs.update(this.currentTask.id, {
      status: this.currentTask.status,
      plan: this.savedPlan || this.currentTask.plan,
      files: this.currentTask.files,
      adrs: this.currentTask.adrs,
      tests: this.currentTask.tests,
      securityIssues: this.currentTask.securityIssues,
      performanceMetrics: this.currentTask.performanceMetrics,
      reliability: this.currentTask.reliability,
      tokenStats: this.currentTask.tokenStats,
      deployUrl: this.currentTask.deployUrl,
      error: this.currentTask.error,
      finishedAt: this.currentTask.finishedAt || null,
      config: this.savedConfig || this.currentTask.config
    });
  }

  saveFileVersions(files, labelVersion) {
    if (!this.currentTask?.id) return;
    for (const file of files || []) {
      if (!file?.path) continue;
      const key = file.path;
      this.fileVersionCounters[key] = (this.fileVersionCounters[key] || 0) + 1;
      const version = labelVersion || this.fileVersionCounters[key];
      runs.saveFileVersion(this.currentTask.id, file.path, file.content || '', version);
    }
  }

  /**
   * Pausa o pipeline e exige aprovação humana para a próxima etapa.
   */
  async pauseForApproval(nextStage, message) {
    this.throwIfAborted();
    this.currentTask.status = 'awaiting_approval';
    this.currentTask.pendingNextStage = nextStage;
    this.currentTask.approvalLabel = STAGE_LABELS[nextStage] || nextStage;
    this.currentTask.approvalMessage = message;
    this.savedConfig = {
      ...this.savedConfig,
      pendingNextStage: nextStage,
      healingAttempts: this.healingAttempts,
      userFixAttempts: this.userFixAttempts
    };
    // currentTask.config é o que GET /api/agent/status devolve direto (sem passar
    // por savedConfig); sem este sync, healingAttempts fica correto no WS/DB mas
    // some depois de um reload de página ou reconexão.
    this.currentTask.config = this.savedConfig;
    this.persistTask({ status: 'awaiting_approval' });
    runs.update(this.currentTask.id, {
      plan: this.savedPlan,
      status: 'awaiting_approval',
      config: this.savedConfig,
      adrs: this.currentTask.adrs,
      files: this.currentTask.files,
      tests: this.currentTask.tests,
      securityIssues: this.currentTask.securityIssues,
      performanceMetrics: this.currentTask.performanceMetrics
    });
    this.log('orchestrator', message || `Aguardando aprovação: ${this.currentTask.approvalLabel}`, 'warning');
    this.broadcast('task-awaiting-approval', this.currentTask);
    this.isExecuting = false;
  }

  async run(prompt, runConfig, options = {}) {
    if (this.hasBlockingTask()) {
      throw new Error(
        this.currentTask?.status === 'awaiting_approval'
          ? 'Há uma execução aguardando aprovação. Cancele ou aprove antes de iniciar outra.'
          : 'Já existe uma execução em andamento'
      );
    }

    this.isExecuting = true;
    this.fileVersionCounters = {};
    this.healingAttempts = 0;
    this.userFixInvoked = false;
    this.userFixAttempts = 0;
    this.createAbortController();

    const owner = runConfig.owner || options.owner || null;
    const environment = runConfig.environment === 'staging' ? 'staging' : 'local';
    const cfg = { ...runConfig, environment, owner: undefined };
    let persisted;
    if (options.existingRunId) {
      runs.update(options.existingRunId, {
        status: 'planning',
        config: cfg,
        ownerId: owner?.id || null,
        ownerName: owner?.name || null,
        ownerRole: owner?.role || null,
        environment,
        queuePosition: null
      });
      persisted = runs.get(options.existingRunId);
    } else {
      persisted = runs.create({
        projectId: cfg.projectId || null,
        prompt,
        config: cfg,
        owner
      });
    }

    this.currentTask = {
      id: persisted.id,
      prompt,
      status: 'planning',
      startTime: persisted.started_at,
      files: [],
      adrs: [],
      tests: [],
      securityIssues: [],
      performanceMetrics: null,
      tokenStats: emptyTokenStats(),
      config: cfg,
      deployUrl: null,
      error: null,
      pendingNextStage: null,
      owner,
      environment
    };

    this.savedConfig = cfg;
    this.broadcast('task-started', this.currentTask);

    try {
      this.throwIfAborted();
      const architect = require('./architect');
      this.broadcast('agent-active', { agent: 'architect' });
      this.log('architect', 'Iniciando planejamento arquitetural...', 'info');

      const plan = await architect.execute(prompt, runConfig, this);
      this.throwIfAborted();

      this.savedPlan = plan;
      this.currentTask.adrs = plan.adrs || [];
      this.currentTask.files = (plan.files || []).map((f) => ({
        name: f.name,
        path: f.path,
        content: ''
      }));
      this.savedPrompt = prompt;

      const { summarizePlan } = require('../lib/architectPlan');
      this.log(
        'architect',
        `Planejamento concluído. ${summarizePlan(plan)}.`,
        'success'
      );
      this.broadcast('agent-finished', { agent: 'architect', status: 'success', data: plan });
      await this.pauseForApproval(
        'coder',
        'Arquitetura pronta. Aprove para iniciar a codificação.'
      );
    } catch (error) {
      await this.failOrCancel(error);
      this.isExecuting = false;
      await this.promoteQueue();
    }
  }

  async startQueuedRun(queuedRun, runConfig, owner) {
    return this.run(queuedRun.prompt, { ...runConfig, owner }, { existingRunId: queuedRun.id, owner });
  }

  async startQueuedValidate(queuedRun, runConfig, owner) {
    return this.validateExisting(runConfig.sourcePath, { ...runConfig, owner }, {
      existingRunId: queuedRun.id,
      owner
    });
  }

  async promoteQueue() {
    try {
      const { runQueue } = require('../lib/runQueue');
      await runQueue.tryStartNext(this);
    } catch (err) {
      this.log?.('orchestrator', `Fila: ${err.message}`, 'warning');
    }
  }

  async approveAndContinue(customConfig = {}, planPatch = null, member = null) {
    // Claim synchronously so concurrent approves get a hard error before HTTP 200.
    if (this.isExecuting) throw new Error('Já existe uma execução em andamento');
    if (!this.currentTask || this.currentTask.status !== 'awaiting_approval') {
      throw new Error('Nenhuma tarefa aguardando aprovação');
    }

    const pendingFromTask = this.currentTask.pendingNextStage;
    const pendingFromSaved = this.savedConfig?.pendingNextStage;
    const mode = customConfig.mode || this.savedConfig?.mode || 'forge';
    const defaultStage = mode === 'validate' ? 'qa' : 'coder';
    const nextStage = pendingFromTask || pendingFromSaved || defaultStage;
    if (!STAGE_LABELS[nextStage]) {
      throw new Error(`Etapa pendente inválida: ${nextStage}`);
    }

    const { assertCanApprove } = require('../lib/rbac');
    assertCanApprove(member || { role: 'admin', isAdmin: true }, nextStage);
    this.log(
      'orchestrator',
      `Aprovação por ${member?.name || 'Admin'} (${member?.role || 'admin'}) → ${STAGE_LABELS[nextStage]}`,
      'info'
    );

    this.isExecuting = true;
    this.createAbortController();
    // Aprovar É o ato de autorizar continuar gastando (ver ADR-024) — não exige que o humano
    // levante o teto antes; se o gasto real continuar acima do orçamento, a próxima chamada de
    // LLM marca o flag de novo e a run pausa de novo na etapa seguinte, o mesmo padrão de
    // "aprove pra tentar de novo" de qualquer outro erro de etapa.
    if (this.currentTask) this.currentTask.budgetExceeded = false;

    const cfg = require('../lib/config');
    let incoming = { ...customConfig };
    if (
      incoming.llmProvider === 'claude' &&
      cfg.defaultLlmProvider === 'gemini' &&
      cfg.geminiApiKey
    ) {
      incoming.llmProvider = 'gemini';
      incoming.useOllama = false;
      this.log(
        'orchestrator',
        'Provedor Claude ignorado na aprovação (default do servidor é Gemini).',
        'info'
      );
    }
    if (cfg.defaultLlmProvider === 'ollama' && incoming.llmProvider === 'gemini') {
      incoming.llmProvider = 'ollama';
      incoming.useOllama = true;
      this.log(
        'orchestrator',
        'Provedor Gemini da UI substituído pelo default Ollama do servidor.',
        'info'
      );
    }
    const savedTarget = resolveRunTarget(this.savedConfig);
    if (
      savedTarget &&
      incoming.targetPath &&
      incoming.targetPath !== savedTarget &&
      (mode === 'validate' || this.currentTask?.id)
    ) {
      this.log(
        'orchestrator',
        `targetPath da UI (${incoming.targetPath}) ignorado; mantendo ${savedTarget}.`,
        'warning'
      );
      incoming.targetPath = savedTarget;
    }
    if (
      this.savedConfig?.sourcePath &&
      incoming.sourcePath &&
      incoming.sourcePath !== this.savedConfig.sourcePath &&
      mode === 'validate'
    ) {
      incoming.sourcePath = this.savedConfig.sourcePath;
    }
    const runConfig = normalizeRunConfig({ ...this.savedConfig, ...incoming, mode: incoming.mode || mode });
    delete runConfig.pendingNextStage;
    this.savedConfig = { ...runConfig, healingAttempts: this.healingAttempts, userFixAttempts: this.userFixAttempts };

    if (planPatch) {
      const { normalizePlan } = require('../lib/architectPlan');
      if (nextStage === 'coder') {
        this.savedPlan = normalizePlan({
          ...this.savedPlan,
          ...planPatch
        });
      }
      if (planPatch.adrs && (nextStage === 'coder' || nextStage === 'qa')) {
        this.currentTask.adrs = this.savedPlan.adrs;
      }
    }

    this.currentTask.status = nextStage;
    this.currentTask.pendingNextStage = null;
    this.persistTask({ status: nextStage });
    this.broadcast('task-resumed', this.currentTask);
    this.log('orchestrator', `Aprovado. Executando etapa: ${STAGE_LABELS[nextStage] || nextStage}`, 'info');

    try {
      await this.runStage(nextStage, this.savedConfig);
    } catch (error) {
      if (!error.cancelled && this.currentTask) {
        try {
          await this.pauseForApproval(
            nextStage,
            `Etapa "${STAGE_LABELS[nextStage] || nextStage}" interrompida (${error.message}). Aprove para tentar de novo.`
          );
          return nextStage;
        } catch {
          // ignore and fail
        }
      }
      await this.failOrCancel(error);
      await this.promoteQueue();
    } finally {
      if (this.currentTask?.status !== 'awaiting_approval') {
        this.isExecuting = false;
      }
    }
    return nextStage;
  }

  async runStage(stage, runConfig) {
    switch (stage) {
      case 'coder':
        await require('./stages/coderStage').run(this, runConfig);
        break;
      case 'qa':
        await require('./stages/qaStage').run(this, runConfig);
        break;
      case 'security':
        await require('./stages/securityStage').run(this, runConfig);
        break;
      case 'debugger':
        await require('./stages/debuggerStage').run(this, runConfig);
        break;
      case 'healer':
        await require('./stages/healerStage').run(this, runConfig);
        break;
      case 'devops':
        await require('./stages/devopsLoadStage').run(this, runConfig);
        break;
      case 'deploy':
        await require('./stages/deployStage').run(this, runConfig);
        break;
      case 'human':
        await require('./stages/humanStage').run(this, runConfig);
        break;
      case 'userFix':
        await require('./stages/userFixStage').run(this, runConfig);
        break;
      case 'prodReady':
        await require('./stages/prodReadyStage').run(this, runConfig);
        break;
      case 'report':
        await require('./stages/reportStage').run(this);
        break;
      default:
        throw new Error(`Etapa desconhecida: ${stage}`);
    }
  }

  writeFilesToWorkspace(relativeTarget, files) {
    if (!relativeTarget || !Array.isArray(files) || !files.length) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const { resolveWithinWorkspace } = require('../lib/paths');
      const root = resolveWithinWorkspace(relativeTarget);
      let n = 0;
      for (const file of files) {
        if (!file?.path || typeof file.content !== 'string') continue;
        const full = path.join(root, file.path);
        const rel = path.relative(root, full);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, file.content, 'utf8');
        n += 1;
      }
      if (n) this.log('healer', `${n} arquivo(s) gravados em ${relativeTarget}.`, 'info');
    } catch (err) {
      this.log('healer', `Falha ao gravar cura no disco: ${err.message}`, 'warning');
    }
  }

  /**
   * Enfileira relato do usuário para o agente Corretor (independente do fluxo linear).
   */
  queueUserReport(message) {
    const text = String(message || '').trim();
    if (!text) {
      throw Object.assign(new Error('Relato do usuário não pode ficar vazio'), { status: 400 });
    }
    if (!this.currentTask) {
      throw Object.assign(new Error('Nenhuma tarefa ativa para corrigir'), { status: 400 });
    }
    // Sem essa checagem, mandar uma mensagem no chat do terminal DEPOIS de uma run já terminada
    // (completed/failed/cancelled) "ressuscitava" a task pra `awaiting_approval` — currentTask
    // nunca é zerado ao terminar, então isso travava toda run futura com "Há uma execução
    // aguardando aprovação" até alguém aprovar/cancelar manualmente esse fantasma, e nem reinício
    // do servidor limpava (restorePendingApproval também acha esse status na volta).
    if (['completed', 'failed', 'cancelled'].includes(this.currentTask.status)) {
      throw Object.assign(
        new Error('Esta execução já terminou — inicie uma nova run para relatar um problema'),
        { status: 409 }
      );
    }
    if (this.isExecuting) {
      throw Object.assign(new Error('Aguarde a etapa atual terminar antes de enviar o relato'), {
        status: 409
      });
    }
    if (!Array.isArray(this.currentTask.files) || !this.currentTask.files.length) {
      throw Object.assign(new Error('Não há arquivos no run para corrigir'), { status: 400 });
    }

    this.userFixInvoked = true;
    this.savedConfig = {
      ...(this.savedConfig || {}),
      userReport: text,
      pendingNextStage: 'userFix',
      // Persistido pra sobreviver a um restart do servidor no meio da run — sem isso, o flag
      // ficava só em memória; se o processo reiniciasse depois do usuário já ter chamado o
      // Corretor, a run completada mais tarde seria contada como "terminou sem intervenção"
      // nas estatísticas de confiabilidade (ADR-012), mascarando que o humano teve que intervir.
      userFixInvoked: true
    };
    this.currentTask.pendingNextStage = 'userFix';
    this.currentTask.approvalLabel = STAGE_LABELS.userFix;
    this.currentTask.approvalMessage =
      'Relato do usuário recebido. Aprove o Corretor de Erros do Usuário.';
    this.currentTask.status = 'awaiting_approval';
    this.persistTask({
      status: 'awaiting_approval',
      config: this.savedConfig
    });
    this.broadcast('task-awaiting-approval', this.currentTask);
    // A mensagem em si vira uma linha no terminal (tag "user") — sem isso, o texto ficava
    // só guardado em savedConfig.userReport, invisível na conversa; a UI vira um campo de
    // chat que "esquece" o que você acabou de dizer assim que envia.
    this.log('user', text, 'info');
    this.log('orchestrator', 'Relato do usuário enfileirado → Corretor (userFix).', 'info');
    return {
      success: true,
      nextStage: 'userFix',
      message: this.currentTask.approvalMessage
    };
  }

  /**
   * Valida um projeto já existente no workspace (pula Arquiteto/Codificador).
   */
  async validateExisting(sourcePath, runConfig = {}, options = {}) {
    if (this.hasBlockingTask()) {
      throw new Error(
        this.currentTask?.status === 'awaiting_approval'
          ? 'Há uma execução aguardando aprovação. Cancele ou aprove antes de iniciar outra.'
          : 'Já existe uma execução em andamento'
      );
    }

    const { loadProjectFiles } = require('../lib/projectLoader');
    let loaded;
    try {
      loaded = loadProjectFiles(sourcePath);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      error.status = error.status || 400;
      throw error;
    }
    if (!loaded?.files?.length) {
      const error = new Error(`Nenhum arquivo carregado de ${sourcePath}`);
      error.status = 400;
      throw error;
    }

    this.isExecuting = true;
    this.fileVersionCounters = {};
    this.healingAttempts = 0;
    this.userFixInvoked = false;
    this.userFixAttempts = 0;
    this.createAbortController();

    try {
      const prompt = `Validar projeto existente: ${sourcePath}`;
      const owner = runConfig.owner || options.owner || null;
      const environment = runConfig.environment === 'staging' ? 'staging' : 'local';
      const cfg = {
        ...runConfig,
        mode: 'validate',
        sourcePath,
        targetPath: runConfig.targetPath || sourcePath,
        environment,
        owner: undefined
      };

      let persisted;
      if (options.existingRunId) {
        runs.update(options.existingRunId, {
          status: 'planning',
          config: cfg,
          ownerId: owner?.id || null,
          ownerName: owner?.name || null,
          ownerRole: owner?.role || null,
          environment,
          queuePosition: null
        });
        persisted = runs.get(options.existingRunId);
      } else {
        persisted = runs.create({
          projectId: cfg.projectId || null,
          prompt,
          config: cfg,
          owner
        });
      }

      this.savedConfig = cfg;
      this.savedPrompt = prompt;
      this.savedPlan = {
        files: loaded.files.map((f) => ({ name: f.name, path: f.path })),
        adrs: [
          {
            id: 'ADR-VALIDATE',
            title: 'Validação de projeto existente',
            status: 'Aprovado',
            context: `Projeto carregado de ${sourcePath}`,
            decision:
              'Separar criação (Arquiteto/Codificador) da qualidade: executar só QA → Segurança → Depurador → Curador → DevOps → Reporter',
            consequences: 'Não gera código novo; valida, cura se preciso e faz deploy do projeto pronto.'
          }
        ]
      };

      this.currentTask = {
        id: persisted.id,
        prompt,
        status: 'coding',
        startTime: persisted.started_at,
        files: loaded.files,
        adrs: this.savedPlan.adrs,
        tests: [],
        securityIssues: [],
        performanceMetrics: null,
        tokenStats: emptyTokenStats(),
        config: this.savedConfig,
        deployUrl: null,
        error: null,
        owner,
        environment
      };

      this.broadcast('task-started', this.currentTask);
      this.broadcast('agent-finished', {
        agent: 'architect',
        status: 'skipped',
        data: { reason: 'modo validate: projeto pronto, sem arquitetura' }
      });
      this.broadcast('agent-finished', {
        agent: 'coder',
        status: 'skipped',
        data: { reason: 'modo validate: projeto pronto, sem geração de código' }
      });
      this.log(
        'orchestrator',
        `Modo Validar (projeto pronto): Arquiteto/Codificador ignorados. ${loaded.files.length} arquivos de ${sourcePath}`,
        'success'
      );
      this.saveFileVersions(loaded.files);
      this.persistTask({ status: 'awaiting_approval', files: loaded.files, adrs: this.currentTask.adrs });

      await this.pauseForApproval(
        'qa',
        `Projeto pronto "${sourcePath}" carregado. Pipeline de qualidade: QA → Segurança → Depurador/Curador → DevOps → Reporter.`
      );
    } catch (error) {
      await this.failOrCancel(error);
      this.isExecuting = false;
      await this.promoteQueue();
    }
  }

  async emitReportPdf() {
    if (!this.currentTask?.id) return false;
    try {
      this.broadcast('agent-active', { agent: 'reporter' });
      this.log('reporter', 'Gerando relatório detalhado de testes em PDF...', 'info');
      const reporter = require('./reporter');
      const run = runs.get(this.currentTask.id) || this.currentTask;
      const events = runs.listEvents(this.currentTask.id);
      const cfg = this.currentTask.config || this.savedConfig || run.config || {};
      const { path: pdfPath, model } = await reporter.generatePdfForRun(
        {
          ...run,
          tests: this.currentTask.tests,
          securityIssues: this.currentTask.securityIssues,
          performanceMetrics: this.currentTask.performanceMetrics,
          adrs: this.currentTask.adrs,
          files: this.currentTask.files,
          deployUrl: this.currentTask.deployUrl,
          deployRuntime: this.currentTask.deployRuntime || cfg.deployRuntime || null,
          diagnosis: this.currentTask.diagnosis || cfg.lastDiagnosis || null,
          humanReport: this.currentTask.humanReport || cfg.humanReport || cfg.lastHumanReport || null,
          productionReady: this.currentTask.productionReady || cfg.productionReady || cfg.lastProductionReady || null,
          environment: cfg.environment || run.environment || 'local',
          owner: {
            id: run.owner_id || cfg.owner?.id || null,
            name: run.owner_name || cfg.owner?.name || null,
            role: run.owner_role || cfg.owner?.role || null
          },
          gitBranch: run.git_branch || this.currentTask.gitBranch || cfg.gitBranch || null,
          prUrl: run.pr_url || this.currentTask.prUrl || cfg.prUrl || null,
          status: this.currentTask.status === 'awaiting_approval' ? 'completed' : this.currentTask.status,
          config: cfg
        },
        events,
        this
      );
      this.currentTask.reportPdfPath = pdfPath;

      const { computeReliability } = require('../lib/reliability');
      const reliability = computeReliability({
        healingAttempts: this.healingAttempts,
        userFixInvoked: this.userFixInvoked,
        summary: model.summary
      });
      this.currentTask.reliability = reliability;
      this.persistTask({ reliability });

      this.log(
        'reporter',
        `Relatório PDF pronto (${model.summary.testsPassed}/${model.summary.testsTotal} QA): ${pdfPath}`,
        'success'
      );
      this.broadcast('agent-finished', {
        agent: 'reporter',
        status: 'success',
        data: { path: pdfPath, summary: model.summary }
      });
      return true;
    } catch (err) {
      this.log('reporter', `Falha ao gerar PDF: ${err.message}`, 'warning');
      this.broadcast('agent-finished', { agent: 'reporter', status: 'failed', data: { error: err.message } });
      return false;
    }
  }

  async failOrCancel(error) {
    console.error(error);
    if (!this.currentTask) {
      this.isExecuting = false;
      this.broadcast('task-failed', {
        status: 'failed',
        error: error?.message || String(error),
        id: null
      });
      return;
    }

    if (error.cancelled || this.abortController?.signal?.aborted) {
      this.currentTask.status = 'cancelled';
      this.currentTask.error = 'Cancelado pelo usuário';
      this.currentTask.finishedAt = new Date().toISOString();
      this.persistTask({
        status: 'cancelled',
        error: this.currentTask.error,
        finishedAt: this.currentTask.finishedAt
      });
      this.log('orchestrator', 'Execução cancelada.', 'warning');
      this.broadcast('task-cancelled', this.currentTask);
      this.isExecuting = false;
      await this.promoteQueue();
      return;
    }

    this.currentTask.status = 'failed';
    this.currentTask.error = error.message;
    this.currentTask.finishedAt = new Date().toISOString();
    this.persistTask({
      status: 'failed',
      error: error.message,
      finishedAt: this.currentTask.finishedAt
    });
    this.log('orchestrator', `Falha crítica: ${error.message}`, 'error');
    await this.emitReportPdf();
    this.broadcast('task-failed', this.currentTask);
    this.isExecuting = false;
    await this.promoteQueue();
  }

  async cancel() {
    if (!this.currentTask || (!this.isExecuting && this.currentTask.status !== 'awaiting_approval')) {
      return { success: false, message: 'Nenhuma execução ativa para cancelar' };
    }

    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }

    try {
      const runner = require('../sandbox/runner');
      await runner.stop(this);
    } catch (e) {
      console.error('Sandbox stop on cancel failed', e);
    }

    try {
      const devops = require('./devops');
      devops.killDeploy?.()?.catch?.(() => undefined);
    } catch (e) {
      // ignore
    }

    // Always finalize when idle at a gate; mid-stage cancel relies on abort + pauseForApproval throwIfAborted.
    if (this.currentTask.status === 'awaiting_approval' || !this.isExecuting) {
      this.currentTask.status = 'cancelled';
      this.currentTask.error = 'Cancelado pelo usuário';
      this.currentTask.finishedAt = new Date().toISOString();
      this.persistTask({
        status: 'cancelled',
        error: this.currentTask.error,
        finishedAt: this.currentTask.finishedAt
      });
      this.isExecuting = false;
      this.broadcast('task-cancelled', this.currentTask);
      await this.promoteQueue();
    }

    return { success: true, message: 'Cancelamento solicitado' };
  }
}

module.exports = Orchestrator;
module.exports.STAGE_LABELS = STAGE_LABELS;
