import { describe, it, expect } from 'vitest';
import { resolveModelLimits, formatTokens, pct } from './modelLimits';

describe('resolveModelLimits', () => {
  it('reconhece um modelo Gemini conhecido', () => {
    const info = resolveModelLimits('gemini', 'gemini-2.5-flash');
    expect(info.source).toBe('known');
    expect(info.contextWindow).toBe(1_048_576);
    expect(info.maxOutput).toBe(65_536);
  });

  it('prioriza a regra mais específica antes da genérica do mesmo provedor', () => {
    const info = resolveModelLimits('claude', 'claude-3-7-sonnet');
    expect(info.source).toBe('known');
    expect(info.maxOutput).toBe(64_000);
  });

  it('cai no fallback do provedor quando o modelo é desconhecido', () => {
    const info = resolveModelLimits('ollama', 'um-modelo-qualquer-nao-mapeado');
    expect(info.source).toBe('estimate');
    expect(info.contextWindow).toBe(32_768);
    expect(info.label).toBe('um-modelo-qualquer-nao-mapeado');
  });

  it('cai no fallback do provedor quando não há nome de modelo', () => {
    const info = resolveModelLimits('openai', null);
    expect(info.source).toBe('estimate');
    expect(info.label).toBe('openai');
  });
});

describe('formatTokens', () => {
  it('formata milhões com sufixo M', () => {
    expect(formatTokens(2_000_000)).toBe('2M');
    expect(formatTokens(2_500_000)).toBe('2.50M');
  });

  it('formata milhares com sufixo k', () => {
    expect(formatTokens(15_000)).toBe('15k');
    expect(formatTokens(15_500)).toBe('15.5k');
  });

  it('formata valores pequenos sem sufixo', () => {
    expect(formatTokens(500)).toBe('500');
  });

  it('nunca retorna negativo para entradas inválidas', () => {
    expect(formatTokens(-100)).toBe('0');
    expect(formatTokens(NaN)).toBe('0');
  });
});

describe('pct', () => {
  it('calcula a porcentagem arredondada em uma casa decimal', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(50, 100)).toBe(50);
  });

  it('trava em 100 mesmo se used > total', () => {
    expect(pct(150, 100)).toBe(100);
  });

  it('retorna 0 quando total é zero ou ausente', () => {
    expect(pct(10, 0)).toBe(0);
    expect(pct(10, undefined as unknown as number)).toBe(0);
  });
});
