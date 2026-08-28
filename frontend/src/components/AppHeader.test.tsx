import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './AppHeader';
import type { AppState } from '../hooks/useForjaApp';

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    teamMe: null,
    serviceStatus: null,
    dockerActive: false,
    ollamaOnline: false,
    cursorOnline: false,
    wsConnected: false,
    llmProbe: null,
    llmProbeLoading: false,
    llmProvider: 'gemini',
    ollamaModel: 'qwen2.5-coder:7b',
    openaiModel: 'gpt-4.1',
    claudeModel: 'claude-sonnet-4-20250514',
    geminiModel: 'gemini-3.6-flash',
    serviceBusy: false,
    runServiceAction: vi.fn(),
    ...overrides
  } as unknown as AppState;
}

describe('AppHeader', () => {
  it('mostra os indicadores de infraestrutura como off quando tudo está desconectado', () => {
    render(<AppHeader s={makeState()} />);
    expect(screen.getByLabelText('Docker off')).toBeInTheDocument();
    expect(screen.getByLabelText('Ollama off')).toBeInTheDocument();
    expect(screen.getByLabelText('Cursor off')).toBeInTheDocument();
    expect(screen.getByLabelText('WebSocket offline')).toBeInTheDocument();
  });

  it('reflete o estado online quando os serviços estão de pé', () => {
    render(
      <AppHeader
        s={makeState({
          serviceStatus: { online: true, host: '127.0.0.1', port: 3001, pids: [1], watch: { enabled: false, pid: null } },
          dockerActive: true,
          ollamaOnline: true,
          cursorOnline: true,
          wsConnected: true
        })}
      />
    );
    expect(screen.getByLabelText('API online :3001')).toBeInTheDocument();
    expect(screen.getByLabelText('Docker ok')).toBeInTheDocument();
    expect(screen.getByLabelText('Ollama ok')).toBeInTheDocument();
    expect(screen.getByLabelText('Cursor ok')).toBeInTheDocument();
    expect(screen.getByLabelText('WebSocket online')).toBeInTheDocument();
  });

  it('mostra o nome/papel do membro logado quando presente', () => {
    render(<AppHeader s={makeState({ teamMe: { id: '1', name: 'Ana', role: 'lead' } })} />);
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('chama runServiceAction("restart") ao clicar em Reiniciar', async () => {
    const runServiceAction = vi.fn();
    const user = userEvent.setup();
    render(<AppHeader s={makeState({ runServiceAction })} />);

    await user.click(screen.getByRole('button', { name: 'Reiniciar serviço' }));
    expect(runServiceAction).toHaveBeenCalledWith('restart');
  });

  it('desabilita Start quando o serviço já está online', () => {
    render(
      <AppHeader
        s={makeState({
          serviceStatus: { online: true, host: '127.0.0.1', port: 3001, pids: [1], watch: { enabled: false, pid: null } }
        })}
      />
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('mostra o provedor e o modelo ativos na faixa de motor', () => {
    render(<AppHeader s={makeState({ llmProvider: 'ollama', ollamaModel: 'qwen2.5-coder:7b' })} />);
    expect(screen.getByText('Ollama')).toBeInTheDocument();
    expect(screen.getByText('qwen2.5-coder:7b')).toBeInTheDocument();
  });

  it('pulsa a faixa de motor só quando há um agente ativo', () => {
    const { container, rerender } = render(<AppHeader s={makeState({ activeAgent: null })} />);
    expect(container.querySelector('.engine-pulse.live')).not.toBeInTheDocument();

    rerender(<AppHeader s={makeState({ activeAgent: 'coder' })} />);
    expect(container.querySelector('.engine-pulse.live')).toBeInTheDocument();
  });
});
