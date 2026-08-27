import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RulesCard } from './RulesCard';
import type { AppState } from '../hooks/useForjaApp';

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    newRule: '',
    setNewRule: vi.fn(),
    styleRules: [],
    saveRules: vi.fn(),
    setStyleRules: vi.fn(),
    showToast: vi.fn(),
    ...overrides
  } as unknown as AppState;
}

describe('RulesCard', () => {
  it('lista as regras existentes e permite remover uma', async () => {
    const saveRules = vi.fn();
    const state = makeState({ styleRules: ['Regra A', 'Regra B'], saveRules });
    const user = userEvent.setup();
    render(<RulesCard s={state} />);

    expect(screen.getByText('Regra A')).toBeInTheDocument();
    expect(screen.getByText('Regra B')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remover regra: Regra A' }));
    expect(saveRules).toHaveBeenCalledWith(['Regra B']);
  });

  it('mostra aviso de lista vazia quando não há regras', () => {
    render(<RulesCard s={makeState({ styleRules: [] })} />);
    expect(screen.getByText(/Nenhuma regra/)).toBeInTheDocument();
  });

  it('adiciona uma nova regra ao clicar em Adicionar', async () => {
    const setNewRule = vi.fn();
    const saveRules = vi.fn();
    const state = makeState({ newRule: 'Nova regra digitada', styleRules: ['Existente'], setNewRule, saveRules });
    const user = userEvent.setup();
    render(<RulesCard s={state} />);

    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));

    expect(setNewRule).toHaveBeenCalledWith('');
    expect(saveRules).toHaveBeenCalledWith(['Existente', 'Nova regra digitada']);
  });

  it('não adiciona regra em branco', async () => {
    const saveRules = vi.fn();
    const state = makeState({ newRule: '   ', saveRules });
    const user = userEvent.setup();
    render(<RulesCard s={state} />);

    await user.click(screen.getByRole('button', { name: 'Adicionar regra' }));
    expect(saveRules).not.toHaveBeenCalled();
  });
});
