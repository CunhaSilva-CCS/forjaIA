import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestsCard } from './TestsCard';
import type { AppState } from '../hooks/useForjaApp';

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    tests: [],
    currentRunId: null,
    showToast: () => {},
    ...overrides
  } as unknown as AppState;
}

describe('TestsCard', () => {
  it('mostra o estado vazio quando não há testes ainda', () => {
    render(<TestsCard s={makeState()} />);
    expect(screen.getByText('Sem testes ainda.')).toBeInTheDocument();
  });

  it('marca teste aprovado com a classe passed e reprovado com failed', () => {
    const { container } = render(
      <TestsCard
        s={makeState({
          tests: [
            { name: 'Login OK', passed: true, error: null },
            { name: 'Login inválido', passed: false, error: 'Esperado 401, recebeu 404' }
          ]
        })}
      />
    );
    const rows = container.querySelectorAll('.test-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass('passed');
    expect(rows[1]).toHaveClass('failed');
    expect(screen.getByText('Esperado 401, recebeu 404')).toBeInTheDocument();
  });

  it('mostra o contador de aprovados/total no título', () => {
    render(
      <TestsCard
        s={makeState({
          tests: [
            { name: 'a', passed: true, error: null },
            { name: 'b', passed: true, error: null },
            { name: 'c', passed: false, error: 'falhou' }
          ]
        })}
      />
    );
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('não mostra mensagem de erro para teste aprovado', () => {
    render(
      <TestsCard
        s={makeState({
          tests: [{ name: 'ok', passed: true, error: null }]
        })}
      />
    );
    expect(screen.queryByText(/falhou|erro/i)).not.toBeInTheDocument();
  });
});
