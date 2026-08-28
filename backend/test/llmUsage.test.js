const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'usage-test-token-with-24-chars-x';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-usage-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-usage-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3099';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('llmUsage.record + summarySince (ADR-017)', () => {
  it('registra e soma tokens/chamadas por provedor', () => {
    require('../lib/db').getDb(); // garante que as tabelas foram migradas
    const { llmUsage } = fresh('../lib/llmUsage');

    llmUsage.record({ provider: 'gemini', model: 'gemini-3.6-flash', tokens: { prompt: 100, completion: 20, total: 120 } });
    llmUsage.record({ provider: 'gemini', model: 'gemini-3.6-flash', tokens: { prompt: 50, completion: 10, total: 60 } });
    llmUsage.record({ provider: 'claude', model: 'claude-haiku', tokens: { prompt: 200, completion: 30, total: 230 } });

    const since = new Date(Date.now() - 60000).toISOString();
    const summary = llmUsage.summarySince(since);
    assert.equal(summary.gemini.calls, 2);
    assert.equal(summary.gemini.tokens, 180);
    assert.equal(summary.claude.calls, 1);
    assert.equal(summary.claude.tokens, 230);
  });

  it('não registra nada quando tokens está ausente', () => {
    require('../lib/db').getDb();
    const { llmUsage } = fresh('../lib/llmUsage');
    llmUsage.record({ provider: 'openai', model: 'x', tokens: null });
    const since = new Date(Date.now() - 60000).toISOString();
    const summary = llmUsage.summarySince(since);
    assert.equal(summary.openai, undefined);
  });

  it('periods() traz hoje/semana/mês pra todos os provedores conhecidos, mesmo sem uso', () => {
    require('../lib/db').getDb();
    const { llmUsage, ALL_PROVIDERS } = fresh('../lib/llmUsage');
    const periods = llmUsage.periods();
    for (const p of ALL_PROVIDERS) {
      assert.ok(periods[p], `esperava entrada pra ${p}`);
      assert.ok('today' in periods[p] && 'week' in periods[p] && 'month' in periods[p]);
    }
  });
});

describe('providerCooldown (ADR-017)', () => {
  it('set/get: cooldown ativo é retornado; expira sozinho pelo tempo', () => {
    require('../lib/db').getDb();
    const { providerCooldown } = fresh('../lib/llmUsage');
    providerCooldown.set('claude', { reason: 'sem crédito', ms: 60000 });
    const active = providerCooldown.get('claude');
    assert.ok(active);
    assert.equal(active.provider, 'claude');
    assert.match(active.reason, /crédito/);
  });

  it('cooldown com ms negativo (já expirado) não é retornado por get()', () => {
    require('../lib/db').getDb();
    const { providerCooldown } = fresh('../lib/llmUsage');
    providerCooldown.set('openai', { reason: 'x', ms: -1000 });
    assert.equal(providerCooldown.get('openai'), null);
  });

  it('clear() remove o cooldown', () => {
    require('../lib/db').getDb();
    const { providerCooldown } = fresh('../lib/llmUsage');
    providerCooldown.set('gemini', { reason: 'x', ms: 60000 });
    assert.ok(providerCooldown.get('gemini'));
    providerCooldown.clear('gemini');
    assert.equal(providerCooldown.get('gemini'), null);
  });

  it('listActive() só lista cooldowns não-expirados', () => {
    require('../lib/db').getDb();
    const { providerCooldown } = fresh('../lib/llmUsage');
    providerCooldown.set('claude', { reason: 'ativo', ms: 60000 });
    providerCooldown.set('openai', { reason: 'expirado', ms: -1000 });
    const active = providerCooldown.listActive();
    assert.ok(active.some((c) => c.provider === 'claude'));
    assert.ok(!active.some((c) => c.provider === 'openai'));
  });
});
