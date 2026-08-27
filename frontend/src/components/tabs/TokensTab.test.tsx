import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokensTab } from './TokensTab';
import type { AppState } from '../../hooks/useForjaApp';
import type { RunSummary } from '../../types/agent';

function makeRun(overrides: Partial<RunSummary>): RunSummary {
  return {
    id: 'run-1',
    project_id: null,
    prompt: 'Criar uma API de Autenticação com JWT',
    status: 'completed',
    started_at: '2026-08-27T14:21:11.952Z',
    tokenStats: { prompt: 800, completion: 200, total: 1000, calls: 2 },
    config: { llmProvider: 'gemini' },
    ...overrides
  };
}

function makeState(runs: RunSummary[]): AppState {
  return {
    runs,
    openRun: vi.fn()
  } as unknown as AppState;
}

describe('TokensTab', () => {
  it('mostra aviso quando nenhuma execução tem tokens registrados', () => {
    render(<TokensTab s={makeState([])} />);
    expect(screen.getByText(/Nenhuma execução com consumo de tokens/)).toBeInTheDocument();
  });

  it('ignora execuções com zero tokens no cálculo, mas soma as demais corretamente', () => {
    const runs = [
      makeRun({ id: 'a', tokenStats: { prompt: 800, completion: 200, total: 1000, calls: 2 }, config: { llmProvider: 'gemini' } }),
      makeRun({ id: 'b', tokenStats: { prompt: 0, completion: 0, total: 0, calls: 0 } }),
      makeRun({ id: 'c', tokenStats: { prompt: 1500, completion: 500, total: 2000, calls: 3 }, config: { llmProvider: 'ollama' } })
    ];
    const { container } = render(<TokensTab s={makeState(runs)} />);

    expect(screen.getByText('3000')).toBeInTheDocument();
    const providers = container.querySelector('.tokens-providers') as HTMLElement;
    expect(within(providers).getByText('Gemini')).toBeInTheDocument();
    expect(within(providers).getByText('Ollama')).toBeInTheDocument();
    // duas execuções com tokens > 0 viram barras na tendência (a de zero tokens não entra)
    expect(container.querySelectorAll('.tokens-trend-bar')).toHaveLength(2);
  });

  it('abre a run correspondente ao clicar numa linha do histórico', async () => {
    const openRun = vi.fn();
    const runs = [makeRun({ id: 'run-xyz' })];
    const state = { runs, openRun } as unknown as AppState;
    const user = userEvent.setup();
    const { container } = render(<TokensTab s={state} />);

    const row = container.querySelector('.tokens-table-row:not(.tokens-table-head)') as HTMLButtonElement;
    expect(row).not.toBeNull();
    await user.click(row);
    expect(openRun).toHaveBeenCalledWith('run-xyz');
  });
});
