/**
 * Ledger de uso por provedor de LLM (ver ADR-017) — nenhum dos provedores (Claude, Gemini,
 * OpenAI) expõe uma API de saldo/crédito consultável só com a chave de API que o ForjaIA usa
 * (isso só existe no painel web de cada um). Em vez de fingir um saldo, registra o que foi
 * REALMENTE consumido (tokens por chamada, com timestamp) — dado real, agregável por período —
 * e reage a falhas de billing já detectadas (ADR-015) marcando o provedor em "cooldown" por um
 * tempo, pra ForjaIA parar de escolhê-lo como primário automaticamente até o cooldown expirar ou
 * o usuário confirmar manualmente que recarregou.
 */
const config = require('./config');

const COOLDOWN_MS = Number(process.env.FORJA_PROVIDER_COOLDOWN_MS || 60 * 60 * 1000); // 1h default

function getDb() {
  return require('./db').getDb();
}

function ensureLlmUsageTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT,
      tier TEXT NOT NULL DEFAULT 'premium',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_usage_provider_created
      ON llm_usage (provider, created_at);

    CREATE TABLE IF NOT EXISTS provider_cooldowns (
      provider TEXT PRIMARY KEY,
      until TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

const ALL_PROVIDERS = ['gemini', 'claude', 'openai', 'ollama', 'cursor'];

const llmUsage = {
  record({ provider, model, tier = 'premium', tokens }) {
    if (!provider || !tokens) return;
    getDb()
      .prepare(
        `INSERT INTO llm_usage (
           provider, model, tier, prompt_tokens, completion_tokens, total_tokens,
           cache_read_tokens, cache_write_tokens, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        provider,
        model || null,
        tier,
        tokens.prompt || 0,
        tokens.completion || 0,
        tokens.total || 0,
        tokens.cacheRead || 0,
        tokens.cacheWrite || 0,
        new Date().toISOString()
      );
  },

  /** Soma tokens/chamadas por provedor desde `sinceIso` (inclusive). */
  summarySince(sinceIso) {
    const rows = getDb()
      .prepare(
        `SELECT provider, COUNT(*) as calls, SUM(total_tokens) as tokens
         FROM llm_usage WHERE created_at >= ? GROUP BY provider`
      )
      .all(sinceIso);
    const byProvider = {};
    for (const row of rows) {
      byProvider[row.provider] = { calls: row.calls, tokens: row.tokens || 0 };
    }
    return byProvider;
  },

  /** Uso agregado por provedor em três janelas (hoje, 7 dias, 30 dias) — todas as métricas são
   * dado real medido, nunca estimativa. */
  periods() {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const windows = {
      today: startOfToday.toISOString(),
      week: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
      month: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
    };

    const result = {};
    for (const provider of ALL_PROVIDERS) {
      result[provider] = { today: { calls: 0, tokens: 0 }, week: { calls: 0, tokens: 0 }, month: { calls: 0, tokens: 0 } };
    }
    for (const [periodName, sinceIso] of Object.entries(windows)) {
      const byProvider = this.summarySince(sinceIso);
      for (const [provider, stats] of Object.entries(byProvider)) {
        if (!result[provider]) result[provider] = { today: { calls: 0, tokens: 0 }, week: { calls: 0, tokens: 0 }, month: { calls: 0, tokens: 0 } };
        result[provider][periodName] = stats;
      }
    }
    return result;
  }
};

const providerCooldown = {
  set(provider, { reason, ms = COOLDOWN_MS } = {}) {
    const until = new Date(Date.now() + ms).toISOString();
    getDb()
      .prepare(
        `INSERT INTO provider_cooldowns (provider, until, reason, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET until = excluded.until, reason = excluded.reason, created_at = excluded.created_at`
      )
      .run(provider, until, String(reason || '').slice(0, 300), new Date().toISOString());
  },

  /** Retorna o cooldown ativo do provedor, ou null se não houver ou já tiver expirado. */
  get(provider) {
    const row = getDb().prepare('SELECT * FROM provider_cooldowns WHERE provider = ?').get(provider);
    if (!row) return null;
    if (new Date(row.until).getTime() <= Date.now()) return null;
    return { provider: row.provider, until: row.until, reason: row.reason };
  },

  /** Todos os cooldowns ainda ativos (não varre os expirados — eles simplesmente deixam de contar). */
  listActive() {
    return ALL_PROVIDERS.map((p) => this.get(p)).filter(Boolean);
  },

  clear(provider) {
    getDb().prepare('DELETE FROM provider_cooldowns WHERE provider = ?').run(provider);
  }
};

module.exports = { ensureLlmUsageTables, llmUsage, providerCooldown, ALL_PROVIDERS, COOLDOWN_MS };
