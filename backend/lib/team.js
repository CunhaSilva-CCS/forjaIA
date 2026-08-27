const crypto = require('crypto');
const { normalizeRole, hashToken, adminIdentity } = require('./rbac');
const config = require('./config');

/** Compara com o token do admin em tempo constante (evita timing attack). */
function isAdminToken(token) {
  const provided = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(hashToken(config.apiToken), 'hex');
  return crypto.timingSafeEqual(provided, expected);
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}

function getDb() {
  return require('./db').getDb();
}

function seedFromEnv(database) {
  let parsed = [];
  try {
    if (config.teamJson) parsed = JSON.parse(config.teamJson);
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    // Célula padrão local (tokens derivados do admin para demo segura)
    const base = hashToken(config.apiToken).slice(0, 16);
    parsed = [
      { name: 'Lead', role: 'lead', token: `lead-${base}` },
      { name: 'QA', role: 'qa', token: `qa-${base}` },
      { name: 'SRE', role: 'sre', token: `sre-${base}` }
    ];
  }

  const insert = database.prepare(
    `INSERT OR IGNORE INTO team_members (id, name, role, token_hash, token_hint, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  );
  const ts = now();
  for (const row of parsed) {
    if (!row?.token || !row?.name) continue;
    const id = createId();
    const role = normalizeRole(row.role);
    const th = hashToken(row.token);
    const hint = String(row.token).slice(0, 4) + '…' + String(row.token).slice(-4);
    insert.run(id, row.name, role, th, hint, ts, ts);
  }
}

function ensureTeamTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_hint TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const count = database.prepare('SELECT COUNT(*) AS c FROM team_members').get().c;
  if (!count) seedFromEnv(database);
}

function publicMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    tokenHint: row.token_hint,
    active: Boolean(row.active),
    createdAt: row.created_at
  };
}

const team = {
  ensure(database) {
    ensureTeamTable(database);
  },

  list() {
    return getDb()
      .prepare('SELECT * FROM team_members WHERE active = 1 ORDER BY role, name')
      .all()
      .map(publicMember);
  },

  listWithBootstrapHints() {
    const members = this.list();
    const base = hashToken(config.apiToken).slice(0, 16);
    return {
      admin: { id: 'admin', name: 'Admin', role: 'admin', tokenHint: 'FORJA_API_TOKEN' },
      members,
      bootstrapTokens:
        members.length && !config.teamJson
          ? {
              lead: `lead-${base}`,
              qa: `qa-${base}`,
              sre: `sre-${base}`,
              note: 'Tokens de bootstrap locais (derivados do admin). Defina FORJA_TEAM_JSON para produção de squad.'
            }
          : null
    };
  },

  get(id) {
    if (id === 'admin') return adminIdentity();
    const row = getDb().prepare('SELECT * FROM team_members WHERE id = ?').get(id);
    return row
      ? {
          id: row.id,
          name: row.name,
          role: row.role,
          isAdmin: false,
          active: Boolean(row.active)
        }
      : null;
  },

  resolveByToken(token) {
    if (!token) return null;
    if (isAdminToken(token)) return adminIdentity();
    const th = hashToken(token);
    const row = getDb()
      .prepare('SELECT * FROM team_members WHERE token_hash = ? AND active = 1')
      .get(th);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      isAdmin: row.role === 'admin',
      active: true
    };
  },

  create({ name, role, token }) {
    if (!name?.trim() || !token?.trim()) {
      const err = new Error('name e token são obrigatórios');
      err.status = 400;
      throw err;
    }
    const id = createId();
    const ts = now();
    const r = normalizeRole(role);
    const th = hashToken(token.trim());
    const hint = token.trim().slice(0, 4) + '…' + token.trim().slice(-4);
    try {
      getDb()
        .prepare(
          `INSERT INTO team_members (id, name, role, token_hash, token_hint, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(id, name.trim(), r, th, hint, ts, ts);
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) {
        const e = new Error('Token já em uso por outro membro');
        e.status = 409;
        throw e;
      }
      throw err;
    }
    return this.get(id);
  },

  deactivate(id) {
    getDb()
      .prepare('UPDATE team_members SET active = 0, updated_at = ? WHERE id = ?')
      .run(now(), id);
    return { success: true };
  }
};

module.exports = { team, ensureTeamTable };
