const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let db;

const MAX_FILE_VERSIONS_PER_PATH = 25;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      plan_json TEXT,
      files_json TEXT,
      adrs_json TEXT,
      tests_json TEXT,
      security_json TEXT,
      metrics_json TEXT,
      token_stats_json TEXT,
      deploy_url TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      agent TEXT,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_file_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_run_file_versions_run_path
      ON run_file_versions (run_id, path, version);

    CREATE TABLE IF NOT EXISTS preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      style_rules_json TEXT NOT NULL DEFAULT '[]',
      feedbacks_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
  `);

  // Phase 1 squad columns (idempotent ALTER)
  const ensureColumn = (table, column, ddl) => {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };
  ensureColumn('runs', 'owner_id', 'owner_id TEXT');
  ensureColumn('runs', 'owner_name', 'owner_name TEXT');
  ensureColumn('runs', 'owner_role', 'owner_role TEXT');
  ensureColumn('runs', 'environment', "environment TEXT DEFAULT 'local'");
  ensureColumn('runs', 'pr_url', 'pr_url TEXT');
  ensureColumn('runs', 'git_branch', 'git_branch TEXT');
  ensureColumn('runs', 'queue_position', 'queue_position INTEGER');
  ensureColumn('runs', 'reliability_json', 'reliability_json TEXT');

  const { ensureTeamTable } = require('./team');
  ensureTeamTable(database);

  const pref = database.prepare('SELECT id FROM preferences WHERE id = 1').get();
  if (!pref) {
    const legacyPath = path.join(__dirname, '../db/preferences.json');
    let styleRules = [];
    let feedbacks = [];
    if (fs.existsSync(legacyPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
        styleRules = raw.styleRules || [];
        feedbacks = raw.feedbacks || [];
      } catch {
        // ignore
      }
    }
    database
      .prepare(
        `INSERT INTO preferences (id, style_rules_json, feedbacks_json, updated_at)
         VALUES (1, ?, ?, ?)`
      )
      .run(JSON.stringify(styleRules), JSON.stringify(feedbacks), new Date().toISOString());
  }

  // Mid-stage crash: convert back to awaiting_approval so restore can resume that stage.
  const midStages = [
    'planning',
    'coding',
    'coder',
    'qa',
    'security',
    'debugger',
    'healer',
    'devops',
    'deploy',
    'human',
    'userFix',
    'prodReady',
    'report'
  ];
  const midRows = database
    .prepare(`SELECT id, status, config_json FROM runs WHERE status IN (${midStages.map(() => '?').join(',')})`)
    .all(...midStages);
  const ts = new Date().toISOString();
  for (const row of midRows) {
    let cfg = {};
    try {
      cfg = row.config_json ? JSON.parse(row.config_json) : {};
    } catch {
      cfg = {};
    }
    const pending =
      [
        'coder',
        'qa',
        'security',
        'debugger',
        'healer',
        'devops',
        'deploy',
        'human',
        'userFix',
        'prodReady',
        'report'
      ].includes(row.status)
        ? row.status
        : row.status === 'coding'
          ? 'coder'
          : cfg.mode === 'validate'
            ? 'qa'
            : 'coder';
    cfg.pendingNextStage = pending;
    cfg.interruptedByRestart = true;
    database
      .prepare(
        `UPDATE runs SET status = 'awaiting_approval', config_json = ?, updated_at = ?,
         error = COALESCE(error, 'Processo reiniciado; etapa disponível para retomar')
         WHERE id = ?`
      )
      .run(JSON.stringify(cfg), ts, row.id);
  }
}

function now() {
  return new Date().toISOString();
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const projects = {
  list() {
    return getDb().prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  },
  get(id) {
    return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
  },
  create({ name, path: projectPath }) {
    const id = createId();
    const ts = now();
    getDb()
      .prepare(
        `INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, name, projectPath, ts, ts);
    return this.get(id);
  },
  update(id, { name, path: projectPath }) {
    const ts = now();
    getDb()
      .prepare(`UPDATE projects SET name = COALESCE(?, name), path = COALESCE(?, path), updated_at = ? WHERE id = ?`)
      .run(name ?? null, projectPath ?? null, ts, id);
    return this.get(id);
  },
  remove(id) {
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  },
  /**
   * Aceita id real, id virtual `ws:path`, ou null. Nunca retorna FK inválida.
   * Se for ws: e o path existir no workspace, registra o projeto automaticamente.
   */
  resolveForRun(projectId, pathHint) {
    if (!projectId) {
      if (!pathHint) return null;
      const byPath = this.list().find((p) => p.path === pathHint);
      return byPath ? byPath.id : null;
    }
    const existing = this.get(projectId);
    if (existing) return existing.id;

    const raw = String(projectId);
    const virtualPath = raw.startsWith('ws:') ? raw.slice(3) : null;
    const candidatePath = virtualPath || pathHint || null;
    if (!candidatePath) return null;

    const byPath = this.list().find((p) => p.path === candidatePath);
    if (byPath) return byPath.id;

    try {
      const { resolveWithinWorkspace } = require('./paths');
      resolveWithinWorkspace(candidatePath);
      const name = candidatePath.split('/').filter(Boolean).pop() || candidatePath;
      const created = this.create({ name, path: candidatePath });
      return created.id;
    } catch {
      return null;
    }
  }
};

const runs = {
  list(limit = 50) {
    return getDb()
      .prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?')
      .all(limit)
      .map(hydrateRun);
  },
  get(id) {
    const row = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return row ? hydrateRun(row) : null;
  },
  create({ projectId, prompt, config: runConfig, owner = null, status = 'planning' }) {
    const id = createId();
    const ts = now();
    const safeProjectId = projects.resolveForRun(
      projectId || null,
      runConfig?.targetPath || runConfig?.sourcePath || null
    );
    const environment = runConfig?.environment === 'staging' ? 'staging' : 'local';
    getDb()
      .prepare(
        `INSERT INTO runs (
           id, project_id, prompt, status, config_json, token_stats_json,
           owner_id, owner_name, owner_role, environment, started_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        safeProjectId,
        prompt,
        status,
        JSON.stringify({ ...(runConfig || {}), environment }),
        JSON.stringify({ prompt: 0, completion: 0, total: 0 }),
        owner?.id || null,
        owner?.name || null,
        owner?.role || null,
        environment,
        ts,
        ts
      );
    return this.get(id);
  },
  update(id, patch) {
    const current = this.get(id);
    if (!current) return null;
    const next = {
      status: patch.status ?? current.status,
      plan_json: patch.plan !== undefined ? JSON.stringify(patch.plan) : current.plan_json,
      files_json: patch.files !== undefined ? JSON.stringify(patch.files) : current.files_json,
      adrs_json: patch.adrs !== undefined ? JSON.stringify(patch.adrs) : current.adrs_json,
      tests_json: patch.tests !== undefined ? JSON.stringify(patch.tests) : current.tests_json,
      security_json:
        patch.securityIssues !== undefined
          ? JSON.stringify(patch.securityIssues)
          : current.security_json,
      metrics_json:
        patch.performanceMetrics !== undefined
          ? JSON.stringify(patch.performanceMetrics)
          : current.metrics_json,
      reliability_json:
        patch.reliability !== undefined ? JSON.stringify(patch.reliability) : current.reliability_json,
      token_stats_json:
        patch.tokenStats !== undefined ? JSON.stringify(patch.tokenStats) : current.token_stats_json,
      deploy_url: patch.deployUrl !== undefined ? patch.deployUrl : current.deploy_url,
      error: patch.error !== undefined ? patch.error : current.error,
      finished_at: patch.finishedAt !== undefined ? patch.finishedAt : current.finished_at,
      config_json: patch.config !== undefined ? JSON.stringify(patch.config) : current.config_json,
      owner_id: patch.ownerId !== undefined ? patch.ownerId : current.owner_id,
      owner_name: patch.ownerName !== undefined ? patch.ownerName : current.owner_name,
      owner_role: patch.ownerRole !== undefined ? patch.ownerRole : current.owner_role,
      environment: patch.environment !== undefined ? patch.environment : current.environment,
      pr_url: patch.prUrl !== undefined ? patch.prUrl : current.pr_url,
      git_branch: patch.gitBranch !== undefined ? patch.gitBranch : current.git_branch,
      queue_position:
        patch.queuePosition !== undefined ? patch.queuePosition : current.queue_position
    };
    getDb()
      .prepare(
        `UPDATE runs SET status=?, plan_json=?, files_json=?, adrs_json=?, tests_json=?, security_json=?,
         metrics_json=?, reliability_json=?, token_stats_json=?, deploy_url=?, error=?, finished_at=?, config_json=?,
         owner_id=?, owner_name=?, owner_role=?, environment=?, pr_url=?, git_branch=?, queue_position=?,
         updated_at=?
         WHERE id=?`
      )
      .run(
        next.status,
        next.plan_json,
        next.files_json,
        next.adrs_json,
        next.tests_json,
        next.security_json,
        next.metrics_json,
        next.reliability_json,
        next.token_stats_json,
        next.deploy_url,
        next.error,
        next.finished_at,
        next.config_json,
        next.owner_id,
        next.owner_name,
        next.owner_role,
        next.environment,
        next.pr_url,
        next.git_branch,
        next.queue_position,
        now(),
        id
      );
    return this.get(id);
  },
  addEvent(runId, { agent, message, type }) {
    getDb()
      .prepare(
        `INSERT INTO run_events (run_id, agent, message, type, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(runId, agent || null, message, type || 'info', now());
  },
  listEvents(runId) {
    return getDb()
      .prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC')
      .all(runId);
  },
  saveFileVersion(runId, filePath, content, version) {
    const database = getDb();
    database
      .prepare(
        `INSERT INTO run_file_versions (run_id, path, content, version, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(runId, filePath, content, version, now());
    // Ciclos repetidos de cura/correção geram uma versão nova a cada tentativa; sem isso
    // a tabela cresce sem limite para runs longas. Mantém só as N mais recentes por arquivo.
    database
      .prepare(
        `DELETE FROM run_file_versions
         WHERE run_id = ? AND path = ?
           AND id NOT IN (
             SELECT id FROM run_file_versions
             WHERE run_id = ? AND path = ?
             ORDER BY version DESC
             LIMIT ?
           )`
      )
      .run(runId, filePath, runId, filePath, MAX_FILE_VERSIONS_PER_PATH);
  },
  listFileVersions(runId, filePath) {
    return getDb()
      .prepare(
        `SELECT * FROM run_file_versions WHERE run_id = ? AND path = ? ORDER BY version ASC`
      )
      .all(runId, filePath);
  },
  maxFileVersions(runId) {
    return getDb()
      .prepare(
        `SELECT path, MAX(version) AS max_version FROM run_file_versions WHERE run_id = ? GROUP BY path`
      )
      .all(runId);
  },
  activeRun() {
    const row = getDb()
      .prepare(
        `SELECT * FROM runs WHERE status IN ('planning', 'coding', 'awaiting_approval', 'coder', 'qa', 'security', 'debugger', 'healer', 'devops', 'deploy', 'human', 'userFix', 'prodReady', 'report') ORDER BY started_at DESC LIMIT 1`
      )
      .get();
    return row ? hydrateRun(row) : null;
  },
  listQueued() {
    return getDb()
      .prepare(`SELECT * FROM runs WHERE status = 'queued' ORDER BY started_at ASC`)
      .all()
      .map(hydrateRun);
  },
  nextQueued() {
    const row = getDb()
      .prepare(`SELECT * FROM runs WHERE status = 'queued' ORDER BY started_at ASC LIMIT 1`)
      .get();
    return row ? hydrateRun(row) : null;
  },
  teamBoard(limit = 40) {
    const recent = this.list(limit);
    const queued = this.listQueued();
    const awaiting = recent.filter((r) => r.status === 'awaiting_approval');
    return { queued, awaiting, recent };
  },
  /**
   * Confiabilidade medida across runs concluídas (ver ADR-012) — só entra na conta o que já foi
   * instrumentado (reliability_json não nulo); nunca uma estimativa, só o que foi de fato medido.
   */
  reliabilityStats() {
    const rows = getDb()
      .prepare(`SELECT reliability_json FROM runs WHERE reliability_json IS NOT NULL`)
      .all()
      .map((r) => safeJson(r.reliability_json, null))
      .filter(Boolean);

    const total = rows.length;
    if (total === 0) {
      return {
        measuredRuns: 0,
        finishedWithoutInterventionRate: null,
        avgHealingAttempts: null,
        userFixInvokedRate: null,
        avgTestPassRate: null,
        humanPassedRate: null
      };
    }

    const sum = (fn) => rows.reduce((acc, r) => acc + fn(r), 0);
    const testRuns = rows.filter((r) => r.testsTotal > 0);
    const humanRuns = rows.filter((r) => r.humanPassed !== null && r.humanPassed !== undefined);

    return {
      measuredRuns: total,
      finishedWithoutInterventionRate: sum((r) => (r.finishedWithoutIntervention ? 1 : 0)) / total,
      avgHealingAttempts: sum((r) => r.healingAttempts || 0) / total,
      userFixInvokedRate: sum((r) => (r.userFixInvoked ? 1 : 0)) / total,
      avgTestPassRate: testRuns.length
        ? testRuns.reduce((acc, r) => acc + r.testsPassed / r.testsTotal, 0) / testRuns.length
        : null,
      humanPassedRate: humanRuns.length
        ? humanRuns.reduce((acc, r) => acc + (r.humanPassed ? 1 : 0), 0) / humanRuns.length
        : null
    };
  }
};

function hydrateRun(row) {
  return {
    ...row,
    config: safeJson(row.config_json, {}),
    plan: safeJson(row.plan_json, null),
    files: safeJson(row.files_json, []),
    adrs: safeJson(row.adrs_json, []),
    tests: safeJson(row.tests_json, []),
    securityIssues: safeJson(row.security_json, []),
    performanceMetrics: safeJson(row.metrics_json, null),
    reliability: safeJson(row.reliability_json, null),
    tokenStats: safeJson(row.token_stats_json, {
      prompt: 0,
      completion: 0,
      total: 0,
      calls: 0,
      peakPrompt: 0,
      peakCompletion: 0,
      peakTotal: 0,
      last: null
    })
  };
}

function safeJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const preferences = {
  get() {
    const row = getDb().prepare('SELECT * FROM preferences WHERE id = 1').get();
    return {
      styleRules: safeJson(row.style_rules_json, []),
      feedbacks: safeJson(row.feedbacks_json, [])
    };
  },
  set({ styleRules, feedbacks }) {
    getDb()
      .prepare(
        `UPDATE preferences SET style_rules_json = ?, feedbacks_json = ?, updated_at = ? WHERE id = 1`
      )
      .run(JSON.stringify(styleRules || []), JSON.stringify(feedbacks || []), now());
    return this.get();
  }
};

module.exports = {
  getDb,
  projects,
  runs,
  preferences,
  createId
};
