import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokenGate } from './TokenGate';
import { api } from '../services/api';
import { getStoredToken } from '../config';

vi.mock('../services/api', () => ({
  api: {
    preferences: {
      get: vi.fn()
    }
  }
}));

describe('TokenGate', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.preferences.get).mockReset();
  });

  it('desabilita o botão Entrar enquanto o token está vazio', () => {
    render(<TokenGate onReady={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeDisabled();
  });

  it('habilita o botão assim que um token é digitado', async () => {
    const user = userEvent.setup();
    render(<TokenGate onReady={vi.fn()} />);
    await user.type(screen.getByLabelText('Token de acesso'), 'meu-token-secreto');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('chama onReady quando o token é válido', async () => {
    vi.mocked(api.preferences.get).mockResolvedValue({ styleRules: [], feedbacks: [] });
    const onReady = vi.fn();
    const user = userEvent.setup();
    render(<TokenGate onReady={onReady} />);

    await user.type(screen.getByLabelText('Token de acesso'), 'token-valido-24-chars-min');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(onReady).toHaveBeenCalledWith('token-valido-24-chars-min'));
  });

  it('mostra uma mensagem de erro quando o token é rejeitado', async () => {
    vi.mocked(api.preferences.get).mockRejectedValue(new Error('Não autorizado'));
    const onReady = vi.fn();
    const user = userEvent.setup();
    render(<TokenGate onReady={onReady} />);

    await user.type(screen.getByLabelText('Token de acesso'), 'token-errado');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não autorizado');
    expect(onReady).not.toHaveBeenCalled();
  });

  it('achado real: não deixa o token rejeitado salvo no localStorage (trava permanente após um typo)', async () => {
    vi.mocked(api.preferences.get).mockRejectedValue(new Error('Não autorizado'));
    const user = userEvent.setup();
    render(<TokenGate onReady={vi.fn()} />);

    await user.type(screen.getByLabelText('Token de acesso'), 'token-com-typo');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await screen.findByRole('alert');
    // Antes desta correção, o token era salvo ANTES de validar — um typo travava o usuário fora
    // do app pra sempre (App.tsx pula a tela de token com Boolean(getStoredToken()) === true).
    expect(getStoredToken()).toBe('');
  });

  it('envia o formulário ao pressionar Enter no campo de token', async () => {
    vi.mocked(api.preferences.get).mockResolvedValue({ styleRules: [], feedbacks: [] });
    const onReady = vi.fn();
    const user = userEvent.setup();
    render(<TokenGate onReady={onReady} />);

    await user.type(screen.getByLabelText('Token de acesso'), 'token-valido-24-chars-min{Enter}');

    await waitFor(() => expect(onReady).toHaveBeenCalled());
  });
});
