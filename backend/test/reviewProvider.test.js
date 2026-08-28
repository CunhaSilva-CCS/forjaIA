const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-reviewprov-${Date.now()}.db`);
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.OPENAI_API_KEY = '';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('resolveReviewProvider — diversidade de modelo na revisão sênior (ADR-011)', () => {
  it('escolhe um provedor diferente do primário quando há alternativa configurada', () => {
    const { resolveReviewProvider } = fresh('../lib/llm');
    assert.notEqual(resolveReviewProvider({ llmProvider: 'claude' }), 'claude');
    assert.notEqual(resolveReviewProvider({ llmProvider: 'gemini' }), 'gemini');
  });

  it('prioriza gemini/claude/openai (nessa ordem) como alternativa, nunca cursor', () => {
    const { resolveReviewProvider } = fresh('../lib/llm');
    // primário é ollama (sem key) → primeira alternativa configurada é gemini
    assert.equal(resolveReviewProvider({ llmProvider: 'ollama' }), 'gemini');
  });

  it('cai pro mesmo provedor quando não há alternativa cloud configurada', () => {
    process.env.GEMINI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    fresh('../lib/config');
    const { resolveReviewProvider } = fresh('../lib/llm');
    assert.equal(resolveReviewProvider({ llmProvider: 'ollama' }), 'ollama');
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    fresh('../lib/config');
  });
});

describe('thinkAsSenior — usa o provedor de revisão, não o primário da run (ADR-011)', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('run primária em claude → revisão sênior chama Gemini, não Claude', async () => {
    fresh('../lib/config');
    fresh('../lib/llm');
    const { thinkAsSenior } = fresh('../lib/seniorEngineer');

    let calledGemini = false;
    let calledClaude = false;
    global.fetch = async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        calledGemini = true;
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 }
          })
        };
      }
      calledClaude = true;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"ok":true}' }], usage: {} }) };
    };

    const orchestrator = { log: () => {}, recordTokens: () => {} };
    await thinkAsSenior({
      role: 'qa',
      taskContract: 'revise a qualidade',
      userPayload: 'contexto',
      runConfig: { llmProvider: 'claude' },
      orchestrator
    });

    assert.equal(calledGemini, true, 'esperava chamada ao Gemini (provedor de revisão)');
    assert.equal(calledClaude, false, 'não deveria ter chamado Claude (mesmo provedor da geração)');
  });
});
