import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReliabilityCard } from './ReliabilityCard';
import type { AppState } from '../hooks/useForjaApp';

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    reliabilityStats: null,
    reliabilityLoading: false,
    refreshReliabilityStats: vi.fn(),
    ...overrides
  } as unknown as AppState;
}

describe('ReliabilityCard', () => {
  it('mostra mensagem de "ainda sem dados" quando measuredRuns é 0', () => {
    render(
      <ReliabilityCard
        s={makeState({
          reliabilityStats: {
            measuredRuns: 0,
            finishedWithoutInterventionRate: null,
            avgHealingAttempts: null,
            userFixInvokedRate: null,
            avgTestPassRate: null,
            humanPassedRate: null
          }
        })}
      />
    );
    expect(screen.getByText(/Ainda sem runs medidas/)).toBeInTheDocument();
  });

  it('mostra os percentuais formatados quando há runs medidas', () => {
    render(
      <ReliabilityCard
        s={makeState({
          reliabilityStats: {
            measuredRuns: 4,
            finishedWithoutInterventionRate: 0.75,
            avgHealingAttempts: 1.5,
            userFixInvokedRate: 0.25,
            avgTestPassRate: 0.9,
            humanPassedRate: null
          }
        })}
      />
    );
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1.5')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('chama refreshReliabilityStats ao clicar no botão de atualizar', async () => {
    const refresh = vi.fn();
    render(
      <ReliabilityCard
        s={makeState({
          reliabilityStats: { measuredRuns: 0, finishedWithoutInterventionRate: null, avgHealingAttempts: null, userFixInvokedRate: null, avgTestPassRate: null, humanPassedRate: null },
          refreshReliabilityStats: refresh
        })}
      />
    );
    screen.getByTitle('Atualizar').click();
    expect(refresh).toHaveBeenCalled();
  });
});
