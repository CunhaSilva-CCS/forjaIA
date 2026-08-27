import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LlmTokensCard } from './LlmTokensCard';
import type { AppState } from '../hooks/useForjaApp';

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    llmProbe: null,
    llmProbeLoading: false,
    refreshLlmProbe: vi.fn(),
    llmProvider: 'gemini',
    setLlmProvider: vi.fn(),
    setUseOllama: vi.fn(),
    ollamaModel: 'qwen2.5-coder:7b',
    setOllamaModel: vi.fn(),
    ollamaModels: [],
    openaiModel: 'gpt-4.1',
    setOpenaiModel: vi.fn(),
    claudeModel: 'claude-sonnet-4-20250514',
    setClaudeModel: vi.fn(),
    tokenStats: { prompt: 0, completion: 0, total: 0, calls: 0, peakPrompt: 0, peakCompletion: 0, peakTotal: 0, last: null },
    tokenQuota: 500000,
    providerLocked: false,
    ...overrides
  } as unknown as AppState;
}

describe('LlmTokensCard', () => {
  it('deixa o seletor de provedor habilitado quando não há run em andamento', () => {
    render(<LlmTokensCard s={makeState({ providerLocked: false })} />);
    expect(screen.getByLabelText('Provedor')).toBeEnabled();
  });

  it('trava o seletor de provedor durante uma run em andamento', () => {
    render(<LlmTokensCard s={makeState({ providerLocked: true })} />);
    const select = screen.getByLabelText('Provedor');
    expect(select).toBeDisabled();
    expect(screen.getByText('Fixo até o fim desta execução')).toBeInTheDocument();
  });
});
