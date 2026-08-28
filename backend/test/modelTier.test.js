const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-tier-${Date.now()}.db`);
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key';
// Sem alternativa cloud configurada: resolveReviewProvider (ADR-011) cai pro mesmo provedor
// (claude), então este arquivo testa só a resolução de tier, isolado da diversidade de provedor
// (coberta em reviewProvider.test.js).
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
process.env.ANTHROPIC_MODEL_ECONOMY = 'claude-haiku-4-5-20251001';
process.env.OPENAI_MODEL = 'gpt-4.1';
process.env.OPENAI_MODEL_ECONOMY = 'gpt-4.1-mini';
process.env.GEMINI_MODEL = 'gemini-3.6-flash';
process.env.OLLAMA_DEFAULT_MODEL = 'qwen2.5-coder:7b';
process.env.OLLAMA_MODEL_ECONOMY = 'qwen2.5-coder:3b';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('resolveTierModel — seleção de modelo por tier (ADR-010)', () => {
  it('usa o modelo padrão (premium) quando tier não é economy', () => {
    const { resolveTierModel } = fresh('../lib/llm');
    assert.equal(resolveTierModel('claude', 'premium', {}), 'claude-sonnet-4-20250514');
    assert.equal(resolveTierModel('openai', 'premium', {}), 'gpt-4.1');
    assert.equal(resolveTierModel('gemini', 'premium', {}), 'gemini-3.6-flash');
    assert.equal(resolveTierModel('ollama', 'premium', {}), 'qwen2.5-coder:7b');
  });

  it('usa o modelo econômico quando tier é economy', () => {
    const { resolveTierModel } = fresh('../lib/llm');
    assert.equal(resolveTierModel('claude', 'economy', {}), 'claude-haiku-4-5-20251001');
    assert.equal(resolveTierModel('openai', 'economy', {}), 'gpt-4.1-mini');
    assert.equal(resolveTierModel('ollama', 'economy', {}), 'qwen2.5-coder:3b');
  });

  it('override explícito no runConfig sempre vence, mesmo em economy', () => {
    const { resolveTierModel } = fresh('../lib/llm');
    assert.equal(
      resolveTierModel('claude', 'economy', { claudeModel: 'claude-opus-5' }),
      'claude-opus-5'
    );
    assert.equal(
      resolveTierModel('openai', 'economy', { openaiModel: 'gpt-4.1' }),
      'gpt-4.1'
    );
    assert.equal(
      resolveTierModel('ollama', 'economy', { ollamaModel: 'qwen2.5-coder:14b' }),
      'qwen2.5-coder:14b'
    );
  });
});

describe('thinkAsSenior — usa tier economy (ADR-010)', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('generateJson com tier "economy" resulta no modelo Claude econômico (isolado da diversidade de provedor, ver reviewProvider.test.js)', async () => {
    const { generateJson } = fresh('../lib/llm');

    let capturedBody = null;
    global.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"ok":true}' }],
          usage: { input_tokens: 10, output_tokens: 5 }
        })
      };
    };

    await generateJson({
      system: 'x',
      user: 'y',
      runConfig: { llmProvider: 'claude' },
      tier: 'economy'
    });

    assert.equal(capturedBody.model, 'claude-haiku-4-5-20251001');
  });
});
