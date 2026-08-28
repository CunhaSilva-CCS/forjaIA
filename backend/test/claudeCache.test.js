const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_WORKSPACE_ROOT = process.env.FORJA_WORKSPACE_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'forja-ws-'));
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-cache-${Date.now()}.db`);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('callClaude — prompt caching (ADR-008)', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('marca o bloco fixo (constituição + regras) com cache_control quando o system prompt vem de composeSystemPrompt', async () => {
    const { composeSystemPrompt, stableConstitutionBlock } = fresh('../lib/seniorEngineer');
    const { callClaude } = fresh('../lib/llm');

    const runConfig = { styleRules: ['regra A', 'regra B'] };
    const system = composeSystemPrompt('coder', 'Implemente o arquivo X.', runConfig);

    let capturedBody = null;
    global.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"files":[]}' }],
          usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }
        })
      };
    };

    const result = await callClaude({ system, user: 'faça isso', runConfig });

    assert.ok(Array.isArray(capturedBody.system), 'system deveria virar array de blocos');
    assert.equal(capturedBody.system.length, 2);
    assert.deepEqual(capturedBody.system[0].cache_control, { type: 'ephemeral' });
    assert.equal(capturedBody.system[0].text, stableConstitutionBlock(runConfig));
    assert.ok(!capturedBody.system[1].cache_control, 'só o bloco fixo deve ter cache_control');
    assert.match(capturedBody.system[1].text, /Implemente o arquivo X\./);

    // tokens do prompt somam a parte lida do cache, não só input_tokens "crus"
    assert.equal(result.tokens.prompt, 50 + 900);
    assert.equal(result.tokens.cacheRead, 900);
  });

  it('cai para system como string simples quando o prompt não bate com o bloco fixo esperado', async () => {
    const { callClaude } = fresh('../lib/llm');

    let capturedBody = null;
    global.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 5, output_tokens: 2 } })
      };
    };

    await callClaude({ system: 'um system prompt qualquer, não gerado por composeSystemPrompt', user: 'oi' });

    assert.equal(typeof capturedBody.system, 'string');
  });

  it('inclui o header anthropic-beta de prompt caching', async () => {
    const { callClaude } = fresh('../lib/llm');

    let capturedHeaders = null;
    global.fetch = async (_url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } })
      };
    };

    await callClaude({ system: 'x', user: 'y' });
    assert.equal(capturedHeaders['anthropic-beta'], 'prompt-caching-2024-07-31');
  });
});
