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

  it('achado real: reage à falha de billing marcando o provedor em cooldown (ADR-017)', async () => {
    const { generateJson } = fresh('../lib/llm');
    const { providerCooldown } = fresh('../lib/llmUsage');
    providerCooldown.clear('claude');

    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('api.anthropic.com')) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
        };
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 }
        })
      };
    };

    try {
      await generateJson({ system: 'x', user: 'y', runConfig: { llmProvider: 'claude' } });
      const active = providerCooldown.get('claude');
      assert.ok(active, 'claude deveria estar em cooldown após a falha de billing');
      assert.match(active.reason, /credit balance/i);
    } finally {
      global.fetch = originalFetch;
      providerCooldown.clear('claude');
    }
  });

  it('achado real: chamada bem-sucedida registra uso real em llmUsage (ADR-017)', async () => {
    const { generateJson } = fresh('../lib/llm');
    const { llmUsage } = fresh('../lib/llmUsage');
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3, totalTokenCount: 14 }
      })
    });
    try {
      await generateJson({ system: 'x', user: 'y', runConfig: { llmProvider: 'gemini' } });
      const since = new Date(Date.now() - 60000).toISOString();
      const summary = llmUsage.summarySince(since);
      assert.ok(summary.gemini);
      assert.ok(summary.gemini.tokens >= 14);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('pickBalancedProvider (ADR-017 — uso equilibrado entre provedores, dado real)', () => {
  it('com uso igual (zero), mantém a prioridade padrão gemini→claude→openai', () => {
    // Banco isolado nesta run — testes anteriores no mesmo arquivo já gravaram uso real via
    // generateJson, então precisa de um estado limpo pra testar o caso "sem nenhum uso ainda".
    process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-billing-clean-${Date.now()}.db`);
    fresh('../lib/config');
    fresh('../lib/db').getDb();
    fresh('../lib/llmUsage');
    const { pickBalancedProvider } = fresh('../lib/llm');
    assert.equal(pickBalancedProvider({}), 'gemini');
  });

  it('prioriza o provedor com MENOS tokens usados hoje, não a ordem fixa', async () => {
    const { generateJson, pickBalancedProvider } = fresh('../lib/llm');
    const { llmUsage } = fresh('../lib/llmUsage');
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
        usageMetadata: { promptTokenCount: 90000, candidatesTokenCount: 1000, totalTokenCount: 91000 }
      })
    });
    try {
      // Gasta bastante uso "hoje" no gemini — claude deveria virar a escolha equilibrada.
      await generateJson({ system: 'x', user: 'y', runConfig: { llmProvider: 'gemini' } });
      void llmUsage;
      assert.equal(pickBalancedProvider({}), 'claude');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('exclui provedor em cooldown mesmo que tenha usado menos hoje', () => {
    const { pickBalancedProvider } = fresh('../lib/llm');
    const { providerCooldown } = fresh('../lib/llmUsage');
    providerCooldown.set('gemini', { reason: 'sem crédito', ms: 60000 });
    try {
      const picked = pickBalancedProvider({});
      assert.notEqual(picked, 'gemini');
    } finally {
      providerCooldown.clear('gemini');
    }
  });
});

describe('resolveProvider — evita proativamente o default em cooldown (ADR-017)', () => {
  it('default automático (sem runConfig.llmProvider) troca pra alternativa quando está em cooldown', () => {
    process.env.FORJA_LLM_PROVIDER = 'claude';
    const { resolveProvider } = fresh('../lib/config') && fresh('../lib/llm');
    const { providerCooldown } = fresh('../lib/llmUsage');
    providerCooldown.set('claude', { reason: 'sem crédito', ms: 60000 });
    try {
      const picked = resolveProvider({});
      assert.notEqual(picked, 'claude');
    } finally {
      providerCooldown.clear('claude');
      delete process.env.FORJA_LLM_PROVIDER;
    }
  });

  it('escolha EXPLÍCITA do usuário nunca é sobrescrita, mesmo em cooldown', () => {
    const { resolveProvider } = fresh('../lib/llm');
    const { providerCooldown } = fresh('../lib/llmUsage');
    providerCooldown.set('claude', { reason: 'sem crédito', ms: 60000 });
    try {
      assert.equal(resolveProvider({ llmProvider: 'claude' }), 'claude');
    } finally {
      providerCooldown.clear('claude');
    }
  });
});
