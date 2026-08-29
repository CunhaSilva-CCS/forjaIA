const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { estimateCostUsd } = require('../lib/llmPricing');

describe('estimateCostUsd (ADR-024)', () => {
  it('calcula o custo pra um modelo conhecido, prompt e completion com preços diferentes', () => {
    const cost = estimateCostUsd({
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000
    });
    assert.equal(cost, 3 + 15);
  });

  it('ollama e cursor são sempre custo zero (rodam local/por assinatura, não por token)', () => {
    assert.equal(estimateCostUsd({ provider: 'ollama', model: 'qwen2.5-coder:7b', promptTokens: 1e6, completionTokens: 1e6 }), 0);
    assert.equal(estimateCostUsd({ provider: 'cursor', model: 'auto', promptTokens: 1e6, completionTokens: 1e6 }), 0);
  });

  it('modelo desconhecido cai pro fallback do provedor', () => {
    const cost = estimateCostUsd({
      provider: 'gemini',
      model: 'gemini-nunca-visto-antes',
      promptTokens: 1_000_000,
      completionTokens: 0
    });
    assert.equal(cost, 0.3);
  });

  it('provedor desconhecido devolve null (não finge um número)', () => {
    assert.equal(estimateCostUsd({ provider: 'llm-inventado', model: 'x', promptTokens: 1000, completionTokens: 1000 }), null);
  });

  it('zero tokens dá custo zero', () => {
    assert.equal(estimateCostUsd({ provider: 'claude', model: 'claude-sonnet-4-20250514' }), 0);
  });
});
