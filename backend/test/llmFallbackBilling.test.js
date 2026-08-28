const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-billing-${Date.now()}.db`);
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.OPENAI_API_KEY = '';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('isBillingError (ADR-015)', () => {
  it('reconhece a mensagem real da Anthropic sem crédito', () => {
    const { isBillingError } = fresh('../lib/llm');
    const err = new Error(
      'Erro Claude 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
    );
    assert.equal(isBillingError(err), true);
  });

  it('não confunde rate limit genérico com falta de crédito', () => {
    const { isBillingError } = fresh('../lib/llm');
    assert.equal(isBillingError(new Error('429 rate limit exceeded, try again later')), false);
  });
});

describe('fallbackProviders (ADR-015 — falha de billing prioriza outro cloud, não Ollama)', () => {
  it('sem billingIssue, mantém a ordem original (Ollama antes dos outros clouds)', () => {
    const { fallbackProviders } = fresh('../lib/llm');
    const chain = fallbackProviders('claude', { billingIssue: false });
    assert.equal(chain[0], 'claude');
    assert.equal(chain[1], 'ollama');
  });

  it('com billingIssue=true, tenta outro provedor cloud configurado antes do Ollama', () => {
    const { fallbackProviders } = fresh('../lib/llm');
    const chain = fallbackProviders('claude', { billingIssue: true });
    assert.equal(chain[0], 'claude');
    assert.equal(chain[1], 'gemini');
    assert.ok(chain.indexOf('ollama') > chain.indexOf('gemini'), 'ollama deve vir depois do gemini');
  });
});

describe('generateJson — expande a cadeia com base no motivo real da falha do primário (ADR-015)', () => {
  it('primário falha por billing → tenta gemini antes do ollama, sem passar por ollama primeiro', async () => {
    const { generateJson } = fresh('../lib/llm');
    const calledOrder = [];
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.anthropic.com')) {
        calledOrder.push('claude');
        return {
          ok: false,
          status: 400,
          text: async () =>
            '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
        };
      }
      if (u.includes('generativelanguage.googleapis.com')) {
        calledOrder.push('gemini');
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 }
          })
        };
      }
      calledOrder.push('other:' + u);
      throw new Error('não deveria chamar outro endpoint');
    };

    try {
      const result = await generateJson({ system: 'x', user: 'y', runConfig: { llmProvider: 'claude' } });
      assert.equal(result.provider, 'gemini');
      assert.deepEqual(calledOrder, ['claude', 'gemini'], 'não deveria ter tentado ollama entre claude e gemini');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
