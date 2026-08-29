/**
 * Preço aproximado (USD por 1M tokens) — usado só pra ESTIMAR gasto e alimentar o teto de
 * orçamento por run (ver ADR-024). NÃO é fonte de verdade pra faturamento real: preços de
 * provedor mudam com frequência e esta tabela pode ficar desatualizada — confira a página oficial
 * de cada provedor antes de confiar nisso pra decisão financeira real. Ollama e Cursor ficam de
 * fora: Ollama roda local (custo zero de API), Cursor cobra por assinatura, não por token.
 */
const PRICING_USD_PER_1M = {
  'claude-sonnet-4-20250514': { prompt: 3, completion: 15 },
  'claude-haiku-4-5-20251001': { prompt: 1, completion: 5 },
  'gemini-3.6-flash': { prompt: 0.3, completion: 2.5 },
  'gpt-4.1': { prompt: 2, completion: 8 },
  'gpt-4.1-mini': { prompt: 0.4, completion: 1.6 }
};

// Fallback por provedor quando o modelo exato não está na tabela acima (ex.: operador configurou
// um modelo novo/custom via env) — usa uma estimativa aproximada da família mais recente conhecida
// em vez de simplesmente não estimar nada.
const PROVIDER_FALLBACK = {
  claude: { prompt: 3, completion: 15 },
  gemini: { prompt: 0.3, completion: 2.5 },
  openai: { prompt: 2, completion: 8 }
};

/** Retorna a estimativa em USD, ou `null` quando o provedor é desconhecido (não finge um número). */
function estimateCostUsd({ provider, model, promptTokens = 0, completionTokens = 0 }) {
  if (provider === 'ollama' || provider === 'cursor') return 0;
  const rates = PRICING_USD_PER_1M[model] || PROVIDER_FALLBACK[provider];
  if (!rates) return null;
  return (Number(promptTokens) / 1e6) * rates.prompt + (Number(completionTokens) / 1e6) * rates.completion;
}

module.exports = { estimateCostUsd, PRICING_USD_PER_1M };
