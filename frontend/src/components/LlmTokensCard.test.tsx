import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    llmUsage: null,
    llmUsageLoading: false,
    refreshLlmUsage: vi.fn(),
    clearProviderCooldown: vi.fn(),
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

  it('lista Cursor como opção de provedor e mostra o campo de modelo quando selecionado', async () => {
    const user = userEvent.setup();
    render(<LlmTokensCard s={makeState({ llmProvider: 'cursor', cursorModel: 'auto', setCursorModel: () => {} })} />);
    await user.click(screen.getByLabelText('Provedor'));
    expect(screen.getByRole('option', { name: 'Cursor' })).toBeInTheDocument();
    expect(screen.getByLabelText('Modelo Cursor')).toHaveValue('auto');
  });

  it('mostra tokens usados por período (hoje/7 dias/30 dias) por provedor (ADR-017)', () => {
    render(
      <LlmTokensCard
        s={makeState({
          llmUsage: {
            periods: {
              gemini: { today: { calls: 3, tokens: 1200 }, week: { calls: 10, tokens: 5000 }, month: { calls: 20, tokens: 9000 } },
              claude: { today: { calls: 0, tokens: 0 }, week: { calls: 0, tokens: 0 }, month: { calls: 0, tokens: 0 } },
              openai: { today: { calls: 0, tokens: 0 }, week: { calls: 0, tokens: 0 }, month: { calls: 0, tokens: 0 } },
              ollama: { today: { calls: 0, tokens: 0 }, week: { calls: 0, tokens: 0 }, month: { calls: 0, tokens: 0 } }
            },
            cooldowns: []
          }
        })}
      />
    );
    expect(screen.getByText('1200')).toBeInTheDocument();
    expect(screen.getByText('5000')).toBeInTheDocument();
    expect(screen.getByText('9000')).toBeInTheDocument();
  });

  it('mostra selo de "sem crédito" e botão de reset quando o provedor está em cooldown (ADR-017)', async () => {
    const user = userEvent.setup();
    const clearProviderCooldown = vi.fn();
    render(
      <LlmTokensCard
        s={makeState({
          llmUsage: {
            periods: {
              gemini: { today: { calls: 0, tokens: 0 }, week: { calls: 0, tokens: 0 }, month: { calls: 0, tokens: 0 } },
              claude: { today: { calls: 0, tokens: 0 }, week: { calls: 0, tokens: 0 }, month: { calls: 0, tokens: 0 } },
              openai: { today: { calls: 0, tokens: 0 }, week: { calls: 0, tokens: 0 }, month: { calls: 0, tokens: 0 } },
              ollama: { today: { calls: 0, tokens: 0 }, week: { calls: 0, tokens: 0 }, month: { calls: 0, tokens: 0 } }
            },
            cooldowns: [{ provider: 'claude', until: '2026-08-28T23:59:00.000Z', reason: 'credit balance too low' }]
          },
          clearProviderCooldown
        })}
      />
    );
    expect(screen.getByText(/sem crédito até/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'resetar' }));
    expect(clearProviderCooldown).toHaveBeenCalledWith('claude');
  });
});
