const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const config = require('./lib/config');
const { authMiddleware, authenticateWs } = require('./lib/auth');
const { browseWorkspace, resolveWithinWorkspace, mkdirInWorkspace, listWorkspaceProjects } = require('./lib/paths');
const { projects, runs, preferences, getDb } = require('./lib/db');
const { checkOllama, providerStatus } = require('./lib/llm');
const { streamRunExport } = require('./lib/export');
const {
  parseOrThrow,
  runRequestSchema,
  approveRequestSchema,
  userReportSchema,
  validateRequestSchema,
  preferencesSchema,
  projectSchema,
  browseSchema
} = require('./lib/validation');

const Orchestrator = require('./agent/orchestrator');
const {
  DEFAULT_STYLE_RULES,
  ensureDefaultPreferences
} = require('./lib/seniorEngineer');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true
  })
);
app.use(express.json({ limit: '2mb' }));

// Limite geral: gera bastante tráfego legítimo de polling (status de serviço, health, etc.),
// então a janela é generosa — o objetivo é conter abuso, não o uso normal da UI.
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' }
});
app.use('/api', apiLimiter);

// Limite específico para tentativas de token inválido — só conta respostas de erro
// (skipSuccessfulRequests), então não penaliza uso normal autenticado.
const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Muitas tentativas de autenticação inválidas. Aguarde antes de tentar de novo.' }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  verifyClient: (info) => authenticateWs(info)
});

const orchestrator = new Orchestrator(wss);

// Agendamento opcional da auditoria independente (ver ADR-021) — não faz nada se
// FORJA_AUDIT_SCHEDULE_HOURS não estiver configurado (desligado por padrão).
require('./lib/auditScheduler').startAuditScheduler(orchestrator);

function handleError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Erro interno' });
}

// Health is public so UI can discover requirements before auth setup
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    getDb().prepare('SELECT 1').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const runner = require('./sandbox/runner');
  const dockerActive = await runner.verifyDocker();
  const ollama = await checkOllama();

  res.json({
    ok: dbOk,
    db: dbOk,
    docker: dockerActive,
    ollama,
    llm: providerStatus(),
    requireDocker: config.requireDocker,
    allowMocks: config.allowMocks,
    hasGeminiKey: Boolean(config.geminiApiKey),
    hasOpenAIKey: Boolean(config.openaiApiKey),
    hasAnthropicKey: Boolean(config.anthropicApiKey),
    workspaceRoot: config.workspaceRoot,
    host: config.host,
    port: config.port,
    authRequired: true
  });
});

app.get('/api/llm/status', async (req, res) => {
  try {
    const { probeLlm } = require('./lib/llm');
    const provider = String(req.query.provider || '').trim() || undefined;
    const status = await probeLlm(provider);
    res.json(status);
  } catch (err) {
    handleError(res, err);
  }
});

app.use('/api', authAttemptLimiter, authMiddleware);

app.get('/api/llm/usage', (req, res) => {
  const { llmUsage, providerCooldown } = require('./lib/llmUsage');
  res.json({
    periods: llmUsage.periods(),
    cooldowns: providerCooldown.listActive()
  });
});

app.post('/api/llm/cooldown/:provider/clear', (req, res) => {
  const { providerCooldown } = require('./lib/llmUsage');
  providerCooldown.clear(req.params.provider);
  res.json({ success: true });
});

/**
 * Auditoria independente (Semgrep + npm audit, ver ADR-021) — deliberadamente FORA do pipeline de
 * agentes: dispara sob demanda, roda em background (pode levar dezenas de segundos), nunca
 * bloqueia uma run de forja/validação. 'project' valida o path com resolveWithinWorkspace, o
 * mesmo guard usado por toda rota que toca o filesystem de um projeto.
 */
app.post('/api/audit/run', (req, res) => {
  const { auditRuns, resolveSelfTargetDir, runIndependentAudit } = require('./lib/independentAudit');
  const target = req.body?.target === 'project' ? 'project' : 'self';
  let targetDir;
  try {
    targetDir = target === 'project' ? resolveWithinWorkspace(req.body?.projectPath, { mustExist: true }) : resolveSelfTargetDir();
  } catch (err) {
    return handleError(res, err);
  }

  const row = auditRuns.create({ target, targetPath: targetDir });
  orchestrator.broadcast?.('audit-started', { id: row.id, target, targetPath: targetDir });

  runIndependentAudit({ target, targetDir })
    .then((result) => {
      auditRuns.complete(row.id, result);
      orchestrator.broadcast?.('audit-finished', { id: row.id, summary: result.summary });
    })
    .catch((err) => {
      auditRuns.fail(row.id, err);
      orchestrator.broadcast?.('audit-finished', { id: row.id, error: err.message });
    });

  res.json({ id: row.id, target, targetPath: targetDir, status: 'running' });
});

app.get('/api/audit/runs', (req, res) => {
  const { auditRuns } = require('./lib/independentAudit');
  res.json({ runs: auditRuns.list(Number(req.query.limit) || 30) });
});

app.get('/api/audit/runs/:id', (req, res) => {
  const { auditRuns } = require('./lib/independentAudit');
  const run = auditRuns.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Auditoria não encontrada' });
  res.json(run);
});

app.get('/api/preferences', (req, res) => {
  ensureDefaultPreferences();
  res.json({
    ...preferences.get(),
    defaults: DEFAULT_STYLE_RULES
  });
});

app.post('/api/preferences', (req, res) => {
  try {
    const data = parseOrThrow(preferencesSchema, req.body);
    res.json({ success: true, data: preferences.set(data) });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/preferences/reset-senior', (_req, res) => {
  const data = preferences.set({
    styleRules: [...DEFAULT_STYLE_RULES],
    feedbacks: preferences.get().feedbacks || []
  });
  res.json({ success: true, data, message: 'Regras de Engenheiro Sênior elite restauradas.' });
});

app.get('/api/projects', (req, res) => {
  const registered = projects.list();
  const byPath = new Map(registered.map((p) => [p.path, p]));
  const workspace = listWorkspaceProjects().map((dir) => {
    const existing = byPath.get(dir.path);
    if (existing) {
      return { ...existing, source: 'registered', existsOnDisk: true };
    }
    return {
      id: `ws:${dir.path}`,
      name: dir.name,
      path: dir.path,
      created_at: null,
      updated_at: null,
      source: 'workspace',
      existsOnDisk: true
    };
  });

  // registered projects whose folder was removed still appear
  for (const p of registered) {
    if (!workspace.some((w) => w.path === p.path)) {
      workspace.push({ ...p, source: 'registered', existsOnDisk: false });
    }
  }

  workspace.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  res.json(workspace);
});

app.post('/api/projects/ensure', (req, res) => {
  try {
    const data = parseOrThrow(projectSchema, req.body);
    resolveWithinWorkspace(data.path);
    const full = resolveWithinWorkspace(data.path);
    fs.mkdirSync(full, { recursive: true });
    const existing = projects.list().find((p) => p.path === data.path);
    if (existing) {
      return res.json(existing);
    }
    const project = projects.create({ name: data.name || data.path, path: data.path });
    res.status(201).json(project);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const data = parseOrThrow(projectSchema, req.body);
    resolveWithinWorkspace(data.path);
    const full = resolveWithinWorkspace(data.path);
    fs.mkdirSync(full, { recursive: true });
    const project = projects.create({ name: data.name, path: data.path });
    res.status(201).json(project);
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/projects/:id', (req, res) => {
  try {
    const existing = projects.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Projeto não encontrado' });
    const data = parseOrThrow(projectSchema.partial(), req.body || {});
    if (data.path) resolveWithinWorkspace(data.path);
    res.json(projects.update(req.params.id, data));
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/projects/:id', (req, res) => {
  projects.remove(req.params.id);
  res.json({ success: true });
});

app.get('/api/runs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(runs.list(limit));
});

app.get('/api/runs/stats/reliability', (req, res) => {
  res.json(runs.reliabilityStats());
});

app.get('/api/runs/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Execução não encontrada' });
  const events = runs.listEvents(run.id);
  res.json({ ...run, events });
});

app.get('/api/runs/:id/export', async (req, res) => {
  try {
    await streamRunExport(req.params.id, res);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/runs/:id/report.pdf', async (req, res) => {
  try {
    const run = runs.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Execução não encontrada' });
    const events = runs.listEvents(run.id);
    const reporter = require('./agent/reporter');
    const { path: pdfPath } = await reporter.generatePdfForRun(run, events);
    const filename = path.basename(pdfPath);
    res.download(pdfPath, filename);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/runs/:id/files/:filePath/versions', (req, res) => {
  const filePath = decodeURIComponent(req.params.filePath);
  const versions = runs.listFileVersions(req.params.id, filePath);
  res.json(versions);
});

app.get('/api/ollama/models', async (req, res) => {
  const ollama = await checkOllama();
  res.json({
    online: ollama.online,
    models: ollama.online ? ollama.models : []
  });
});

app.get('/api/agent/status', (req, res) => {
  res.json({
    isExecuting: orchestrator.isExecuting,
    task: orchestrator.currentTask,
    runId: orchestrator.currentTask?.id || null,
    member: req.member
      ? { id: req.member.id, name: req.member.name, role: req.member.role }
      : null
  });
});

app.get('/api/team', (req, res) => {
  try {
    const { team } = require('./lib/team');
    const { STAGE_ROLES } = require('./lib/rbac');
    const info = team.listWithBootstrapHints();
    const isAdmin = Boolean(req.member?.isAdmin) || req.member?.role === 'admin';
    res.json({
      ...info,
      bootstrapTokens: isAdmin ? info.bootstrapTokens : null,
      stageRoles: STAGE_ROLES
    });
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/team/me', (req, res) => {
  res.json({
    id: req.member.id,
    name: req.member.name,
    role: req.member.role,
    isAdmin: Boolean(req.member.isAdmin)
  });
});

app.post('/api/team/members', (req, res) => {
  try {
    if (!req.member?.isAdmin && req.member?.role !== 'admin') {
      return res.status(403).json({ error: 'Somente admin pode criar membros' });
    }
    const { team } = require('./lib/team');
    const member = team.create(req.body || {});
    res.status(201).json(member);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/team/board', (_req, res) => {
  try {
    res.json(runs.teamBoard(50));
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/services/status', async (req, res) => {
  try {
    const serviceControl = require('./lib/serviceControl');
    res.json(await serviceControl.getStatus());
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/services/:action', async (req, res) => {
  try {
    const { canManageServices } = require('./lib/rbac');
    if (!canManageServices(req.member)) {
      return res.status(403).json({
        error: 'Somente admin, lead ou sre podem controlar serviços.'
      });
    }
    const action = String(req.params.action || '').toLowerCase();
    const serviceControl = require('./lib/serviceControl');
    const result = serviceControl.requestAction(action);
    res.json({
      ok: true,
      action,
      result,
      message:
        action === 'restart'
          ? 'Reinício solicitado — a UI pode desconectar por alguns segundos.'
          : action === 'watch'
            ? 'Watchdog automático iniciado (reinicia se o health falhar).'
            : `Ação ${action} enviada.`
    });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/fs/browse', (req, res) => {
  try {
    const { path: browsePath } = parseOrThrow(browseSchema, req.body || {});
    res.json(browseWorkspace(browsePath));
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/fs/mkdir', (req, res) => {
  try {
    const body = parseOrThrow(browseSchema, req.body || {});
    if (!body.path || body.path === '.') {
      const err = new Error('Informe o caminho da pasta a criar (ex: deployed)');
      err.status = 400;
      throw err;
    }
    res.json(mkdirInWorkspace(body.path));
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/workspace', (req, res) => {
  res.json({
    workspaceRoot: config.workspaceRoot,
    defaultPath: '.'
  });
});

app.post('/api/agent/run', async (req, res) => {
  try {
    const { canStartRun } = require('./lib/rbac');
    if (!canStartRun(req.member)) {
      return res.status(403).json({ error: 'Papel "viewer" não pode iniciar uma run.' });
    }
    const body = parseOrThrow(runRequestSchema, req.body);
    const prefs = preferences.get();
    const runConfig = {
      ...body.config,
      styleRules: body.config.styleRules || prefs.styleRules,
      geminiApiKey: undefined,
      environment: body.config?.environment === 'staging' ? 'staging' : 'local',
      owner: req.member
    };

    if (runConfig.targetPath) {
      resolveWithinWorkspace(runConfig.targetPath);
    } else if (runConfig.projectId) {
      const project = projects.get(runConfig.projectId);
      if (project) runConfig.targetPath = project.path;
    }

    runConfig.projectId = projects.resolveForRun(
      runConfig.projectId,
      runConfig.targetPath || null
    );

    if (!runConfig.targetPath) {
      runConfig.targetPath = 'deployed';
      fs.mkdirSync(resolveWithinWorkspace(runConfig.targetPath), { recursive: true });
    }

    if (orchestrator.hasBlockingTask()) {
      const { runQueue } = require('./lib/runQueue');
      const queued = runQueue.enqueue({
        prompt: body.prompt,
        config: runConfig,
        owner: req.member,
        mode: 'forge'
      });
      return res.status(202).json({
        success: true,
        queued: true,
        message: `Forja ocupada — run enfileirado (#${queued.queue_position || '?'}).`,
        run: queued
      });
    }

    orchestrator.run(body.prompt, runConfig).catch((err) => {
      console.error('Erro na execução do orquestrador:', err);
    });

    res.json({ success: true, message: 'Agente iniciado.', owner: req.member?.name });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/agent/validate', async (req, res) => {
  try {
    const { canStartRun } = require('./lib/rbac');
    if (!canStartRun(req.member)) {
      return res.status(403).json({ error: 'Papel "viewer" não pode iniciar uma validação.' });
    }
    const body = parseOrThrow(validateRequestSchema, req.body || {});
    const prefs = preferences.get();
    const runConfig = {
      ...body.config,
      styleRules: body.config.styleRules || prefs.styleRules,
      targetPath: body.config.targetPath || body.sourcePath,
      mode: 'validate',
      sourcePath: body.sourcePath,
      environment: body.config?.environment === 'staging' ? 'staging' : 'local',
      owner: req.member
    };

    resolveWithinWorkspace(body.sourcePath);
    runConfig.projectId = projects.resolveForRun(runConfig.projectId, body.sourcePath);

    const { loadProjectFiles } = require('./lib/projectLoader');
    const preview = loadProjectFiles(body.sourcePath);
    if (!preview?.files?.length) {
      return res.status(400).json({ error: `Nenhum arquivo encontrado em ${body.sourcePath}` });
    }

    if (orchestrator.hasBlockingTask()) {
      const { runQueue } = require('./lib/runQueue');
      const queued = runQueue.enqueue({
        prompt: `Validar ${body.sourcePath}`,
        config: runConfig,
        owner: req.member,
        mode: 'validate'
      });
      return res.status(202).json({
        success: true,
        queued: true,
        message: `Forja ocupada — validação enfileirada (#${queued.queue_position || '?'}).`,
        run: queued
      });
    }

    orchestrator.validateExisting(body.sourcePath, runConfig).catch((err) => {
      console.error('Erro na validação do projeto:', err);
      if (!orchestrator.currentTask) {
        orchestrator.broadcast?.('task-failed', {
          status: 'failed',
          error: err.message || String(err)
        });
      }
    });

    res.json({
      success: true,
      message: `Validação iniciada para ${body.sourcePath} (QA → … → Humano → Produção → Reporter).`,
      filesLoaded: preview.files.length,
      owner: req.member?.name
    });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/agent/approve', async (req, res) => {
  try {
    const body = parseOrThrow(approveRequestSchema, req.body || {});
    if (!orchestrator.currentTask || orchestrator.currentTask.status !== 'awaiting_approval') {
      return res.status(400).json({ error: 'Nenhuma tarefa aguardando aprovação.' });
    }
    if (orchestrator.isExecuting) {
      return res.status(409).json({ error: 'Já existe uma execução de agente em andamento.' });
    }

    const prefs = preferences.get();
    const runConfig = {
      ...body.config,
      styleRules: body.config.styleRules || prefs.styleRules,
      geminiApiKey: undefined
    };

    const pending =
      orchestrator.currentTask.pendingNextStage ||
      orchestrator.savedConfig?.pendingNextStage ||
      'coder';
    const { STAGE_LABELS } = require('./agent/orchestrator');
    const label = STAGE_LABELS[pending] || pending;

    // Claim runs synchronously at the start of approveAndContinue; await microtask
    // so a sync throw becomes a rejected promise we can map to 409 before responding.
    const continuePromise = orchestrator.approveAndContinue(
      runConfig,
      body.planPatch || null,
      req.member
    );
    await Promise.race([
      continuePromise.then(() => null).catch((err) => err),
      new Promise((resolve) => setImmediate(() => resolve(null)))
    ]).then((earlyErr) => {
      if (earlyErr) throw earlyErr;
    });

    continuePromise.catch((err) => {
      console.error('Erro ao continuar orquestração:', err);
    });

    res.json({
      success: true,
      message: `Aprovado. Iniciando etapa: ${label}.`,
      nextStage: pending
    });
  } catch (err) {
    if (
      err?.message?.includes('em andamento') ||
      err?.message?.includes('aguardando aprovação') ||
      err?.message?.includes('Etapa pendente') ||
      err?.message?.includes('não pode aprovar')
    ) {
      return res.status(err.status || 409).json({ error: err.message });
    }
    handleError(res, err);
  }
});

app.post('/api/agent/cancel', async (req, res) => {
  try {
    // Achado real (pente fino): esta rota não tinha NENHUMA checagem de papel — qualquer membro
    // autenticado podia cancelar a run de qualquer outra pessoa, incluindo um deploy de produção
    // em andamento.
    const { canCancelRun } = require('./lib/rbac');
    if (!canCancelRun(req.member)) {
      return res.status(403).json({ error: 'Papel "viewer" não pode cancelar uma execução.' });
    }
    const result = await orchestrator.cancel();
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/agent/user-report', async (req, res) => {
  try {
    const { canReportIssue } = require('./lib/rbac');
    if (!canReportIssue(req.member)) {
      return res.status(403).json({ error: 'Papel "viewer" não pode enviar relato ao Corretor.' });
    }
    const body = parseOrThrow(userReportSchema, req.body || {});
    const result = orchestrator.queueUserReport(body.message);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/docker/status', async (req, res) => {
  const runner = require('./sandbox/runner');
  const active = await runner.verifyDocker();
  res.json({ active, required: config.requireDocker });
});

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      event: 'sync-state',
      data: {
        isExecuting: orchestrator.isExecuting,
        task: orchestrator.currentTask
      }
    })
  );
});

// Produção local: UI e API no mesmo processo (frontend/dist)
const distDir = config.frontendDist;
if (config.isProduction && fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log(`[forja] UI estática servida de ${distDir}`);
} else if (config.isProduction) {
  console.warn('[forja] frontend/dist não encontrado — só API. Rode: npm run build');
}

server.listen(config.port, config.host, () => {
  const seeded = ensureDefaultPreferences();
  console.log(`Plano de controle ForjaIA escutando em http://${config.host}:${config.port}`);
  console.log(`Modo: ${config.isProduction ? 'produção local' : 'desenvolvimento'}`);
  console.log(`Raiz do workspace: ${config.workspaceRoot}`);
  console.log(`Docker obrigatório: ${config.requireDocker}; mocks permitidos: ${config.allowMocks}`);
  if (seeded.seeded) {
    console.log(`Regras de Engenheiro Sênior elite carregadas (${seeded.styleRules.length}).`);
  }
});

module.exports = { app, server, orchestrator };
