/**
 * Auditoria independente — Semgrep (SAST determinístico) + npm audit (dependência vulnerável),
 * ver ADR-021. Deliberadamente SEPARADA do pipeline de agentes (architect→coder→qa→security→...):
 * o SAST de agent/security.js + lib/secretScan.js é heurístico e roda em TODA run (rápido, tem
 * que ser); isto aqui são ferramentas de terceiros, mais lentas e mais pesadas (Semgrep pode levar
 * dezenas de segundos), disparadas sob demanda (CLI/API) ou por agendamento — nunca bloqueiam uma
 * run de forja/validação.
 *
 * Alvo pode ser o próprio ForjaIA ('self', pra responder "posso confiar no ForjaIA?" com dado
 * determinístico, não só raciocínio de LLM) ou um projeto forjado/validado ('project').
 */
const fs = require('fs');
const path = require('path');
const { execAsync } = require('./dockerBuild');

const SEMGREP_CONFIG = process.env.FORJA_SEMGREP_CONFIG || 'p/security-audit';
const SEMGREP_TIMEOUT_S = Number(process.env.FORJA_SEMGREP_TIMEOUT_S || 180);

function getDb() {
  return require('./db').getDb();
}

function ensureAuditTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_runs (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      target_path TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      findings_json TEXT,
      tools_json TEXT,
      summary TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_runs_started ON audit_runs (started_at);
  `);
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const auditRuns = {
  create({ target, targetPath }) {
    const id = createId();
    const startedAt = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO audit_runs (id, target, target_path, status, started_at) VALUES (?, ?, ?, 'running', ?)`
      )
      .run(id, target, targetPath || null, startedAt);
    return { id, target, targetPath, status: 'running', startedAt };
  },

  complete(id, result) {
    getDb()
      .prepare(
        `UPDATE audit_runs SET status = 'completed', findings_json = ?, tools_json = ?, summary = ?, finished_at = ?
         WHERE id = ?`
      )
      .run(JSON.stringify(result.findings || []), JSON.stringify(result.tools || {}), result.summary || '', result.finishedAt, id);
  },

  fail(id, error) {
    getDb()
      .prepare(`UPDATE audit_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`)
      .run(String(error?.message || error || 'erro desconhecido'), new Date().toISOString(), id);
  },

  get(id) {
    const row = getDb().prepare('SELECT * FROM audit_runs WHERE id = ?').get(id);
    if (!row) return null;
    return hydrate(row);
  },

  list(limit = 30) {
    return getDb()
      .prepare('SELECT * FROM audit_runs ORDER BY started_at DESC LIMIT ?')
      .all(limit)
      .map(hydrate);
  }
};

function hydrate(row) {
  return {
    id: row.id,
    target: row.target,
    targetPath: row.target_path,
    status: row.status,
    findings: safeJson(row.findings_json, []),
    tools: safeJson(row.tools_json, {}),
    summary: row.summary,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at
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

/** Raiz do próprio repo ForjaIA (backend/lib/../.. = raiz), pra auditoria 'self'. */
function resolveSelfTargetDir() {
  return path.join(__dirname, '..', '..');
}

async function checkSemgrepAvailable() {
  try {
    await execAsync('semgrep --version');
    return true;
  } catch {
    return false;
  }
}

const SEMGREP_SEVERITY_MAP = { ERROR: 'HIGH', WARNING: 'MEDIUM', INFO: 'LOW' };

function parseSemgrepOutput(stdout) {
  const parsed = JSON.parse(stdout);
  return (parsed.results || []).map((r) => ({
    id: r.check_id,
    severity: SEMGREP_SEVERITY_MAP[r.extra?.severity] || 'MEDIUM',
    title: String(r.extra?.message || r.check_id).split('\n')[0].slice(0, 200),
    file: r.path,
    line: r.start?.line || null,
    description: r.extra?.message || ''
  }));
}

async function runSemgrep(targetDir) {
  const available = await checkSemgrepAvailable();
  if (!available) {
    return {
      tool: 'semgrep',
      available: false,
      findings: [],
      skippedReason: 'semgrep não está instalado (brew install semgrep, ou pip install semgrep)'
    };
  }
  try {
    const { stdout } = await execAsync(
      `semgrep --config=${SEMGREP_CONFIG} --json --quiet --timeout=${SEMGREP_TIMEOUT_S} .`,
      { cwd: targetDir }
    );
    return { tool: 'semgrep', available: true, findings: parseSemgrepOutput(stdout) };
  } catch (err) {
    // Semgrep sai com código != 0 em alguns modos mesmo com JSON válido no stdout (ex.: achados
    // de severidade ERROR fazem o processo retornar não-zero por padrão) — tenta parsear antes
    // de desistir e reportar como falha da ferramenta.
    if (err.stdout) {
      try {
        return { tool: 'semgrep', available: true, findings: parseSemgrepOutput(err.stdout) };
      } catch {
        // cai pro erro abaixo
      }
    }
    return { tool: 'semgrep', available: true, findings: [], error: err.message };
  }
}

function parseNpmAuditOutput(stdout, workspaceLabel) {
  const parsed = JSON.parse(stdout);
  const vulns = parsed.vulnerabilities || {};
  return Object.entries(vulns).map(([name, v]) => ({
    id: `NPM-${workspaceLabel}-${name}`,
    severity: String(v.severity || 'moderate').toUpperCase(),
    title: `Dependência vulnerável: ${name} (${workspaceLabel})`,
    file: `${workspaceLabel}/package.json`,
    line: null,
    description:
      (Array.isArray(v.via)
        ? v.via.map((x) => (typeof x === 'string' ? x : x.title)).filter(Boolean).join('; ')
        : '') || `range ${v.range || 'desconhecido'}`
  }));
}

async function runNpmAuditIn(dir, workspaceLabel) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) return [];
  try {
    const { stdout } = await execAsync('npm audit --json', { cwd: dir });
    return parseNpmAuditOutput(stdout, workspaceLabel);
  } catch (err) {
    // npm audit sai com código != 0 quando ACHA vulnerabilidade — isso não é falha da ferramenta,
    // o achado real está no stdout mesmo assim.
    if (err.stdout) {
      try {
        return parseNpmAuditOutput(err.stdout, workspaceLabel);
      } catch {
        return [];
      }
    }
    return [];
  }
}

async function runNpmAudit(dirs) {
  const findings = [];
  for (const { dir, label } of dirs) {
    findings.push(...(await runNpmAuditIn(dir, label)));
  }
  return { tool: 'npm-audit', available: true, findings };
}

/**
 * Núcleo puro (sem DB, sem HTTP) — `target` é 'self' ou 'project'; `targetDir` já deve estar
 * resolvido e validado pelo chamador (a rota HTTP valida com lib/paths.js antes de chegar aqui;
 * este módulo não sabe nada sobre workspace/auth).
 */
async function runIndependentAudit({ target, targetDir }) {
  const startedAt = new Date().toISOString();
  const npmAuditDirs =
    target === 'self'
      ? [
          { dir: targetDir, label: 'root' },
          { dir: path.join(targetDir, 'backend'), label: 'backend' },
          { dir: path.join(targetDir, 'frontend'), label: 'frontend' }
        ]
      : [{ dir: targetDir, label: 'project' }];

  const [semgrep, npmAudit] = await Promise.all([runSemgrep(targetDir), runNpmAudit(npmAuditDirs)]);

  const allFindings = [...semgrep.findings, ...npmAudit.findings];
  const bySeverity = {};
  for (const f of allFindings) {
    const sev = String(f.severity || '').toUpperCase();
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
  }
  const summary =
    allFindings.length === 0
      ? 'nenhum achado'
      : `${allFindings.length} achado(s) — ${Object.entries(bySeverity)
          .map(([sev, n]) => `${n} ${sev}`)
          .join(', ')}`;

  return {
    target,
    targetDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    tools: { semgrep, npmAudit },
    findings: allFindings,
    summary
  };
}

module.exports = {
  ensureAuditTables,
  auditRuns,
  resolveSelfTargetDir,
  checkSemgrepAvailable,
  runIndependentAudit
};
