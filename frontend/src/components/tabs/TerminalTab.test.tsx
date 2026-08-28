import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalTab } from './TerminalTab';
import type { AppState } from '../../hooks/useForjaApp';
import type { LogLine } from '../../types/agent';

function makeState(logs: LogLine[], overrides: Partial<AppState> = {}): AppState {
  return {
    logs,
    logsEndRef: { current: null },
    isExecuting: false,
    handleUserReport: vi.fn(),
    ...overrides
  } as unknown as AppState;
}

const SHORT_MESSAGE = 'QA finalizado (0/1 ok). Aprove para rodar Segurança.';

const LONG_STACK_TRACE =
  'Erro ao inicializar sandbox para testes: Falha na sandbox Docker: Container da sandbox saiu (exit 1). ' +
  'Logs: > user-service@1.0.0 start > ts-node src/index.ts +/app/node_modules/ts-node/src/index.ts:859 ' +
  'F return new TSError(diagnosticText, diagnosticCodes, diagnostics); ^ +TSError: Unable to compile TypeScript: ' +
  "src/userController.ts(1,44): error TS7016: Could not find a declaration file for module 'express'.";

describe('TerminalTab', () => {
  it('mostra mensagens curtas direto, sem toggle', () => {
    render(<TerminalTab s={makeState([{ agent: 'orchestrator', message: SHORT_MESSAGE, type: 'warning', timestamp: '2026-01-01T00:00:00.000Z' }])} />);
    expect(screen.getByText(SHORT_MESSAGE, { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ver stack trace completo|recolher/ })).not.toBeInTheDocument();
  });

  it('recolhe mensagens longas (stack trace) por padrão, mostrando só o resumo', () => {
    render(<TerminalTab s={makeState([{ agent: 'qa', message: LONG_STACK_TRACE, type: 'error', timestamp: '2026-01-01T00:00:00.000Z' }])} />);
    expect(screen.getByText(/Erro ao inicializar sandbox/)).toBeInTheDocument();
    expect(screen.queryByText(/TSError: Unable to compile TypeScript/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ver stack trace completo/ })).toBeInTheDocument();
  });

  it('expande e recolhe o stack trace ao clicar no toggle', async () => {
    const user = userEvent.setup();
    render(<TerminalTab s={makeState([{ agent: 'qa', message: LONG_STACK_TRACE, type: 'error', timestamp: '2026-01-01T00:00:00.000Z' }])} />);

    await user.click(screen.getByRole('button', { name: /ver stack trace completo/ }));
    expect(screen.getByText(/TSError: Unable to compile TypeScript/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'recolher' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'recolher' }));
    expect(screen.queryByText(/TSError: Unable to compile TypeScript/)).not.toBeInTheDocument();
  });

  it('achado real: uma run nova não herda o estado de "expandido" só por reaproveitar o mesmo índice', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TerminalTab s={makeState([{ agent: 'qa', message: LONG_STACK_TRACE, type: 'error', timestamp: '2026-01-01T00:00:00.000Z' }])} />
    );
    await user.click(screen.getByRole('button', { name: /ver stack trace completo/ }));
    expect(screen.getByRole('button', { name: 'recolher' })).toBeInTheDocument();

    // Mensagem DIFERENTE (outra run), mas no MESMO índice 0 do array de logs — antes desta
    // correção, o estado de expandido era chaveado por índice, então essa nova mensagem
    // renderizava pré-expandida sem nenhum clique.
    const OTHER_LONG_MESSAGE = LONG_STACK_TRACE.replace('userController', 'productController').replace(
      'sandbox para testes',
      'sandbox pra outra run'
    );
    rerender(
      <TerminalTab
        s={makeState([{ agent: 'security', message: OTHER_LONG_MESSAGE, type: 'error', timestamp: '2026-02-02T00:00:00.000Z' }])}
      />
    );
    expect(screen.getByRole('button', { name: /ver stack trace completo/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'recolher' })).not.toBeInTheDocument();
  });

  it('mostra a mensagem do usuário com a tag "você"', () => {
    render(
      <TerminalTab
        s={makeState([{ agent: 'user', message: 'coloque um botão de exportar', type: 'info', timestamp: '2026-01-01T00:00:00.000Z' }])}
      />
    );
    expect(screen.getByText('[você]')).toBeInTheDocument();
    expect(screen.getByText(/coloque um botão de exportar/)).toBeInTheDocument();
  });

  it('envia a mensagem digitada ao clicar em Enviar e limpa o campo', async () => {
    const handleUserReport = vi.fn();
    const user = userEvent.setup();
    render(<TerminalTab s={makeState([], { handleUserReport })} />);

    const input = screen.getByLabelText('Mensagem para o agente');
    await user.type(input, 'ajuste o CORS');
    await user.click(screen.getByRole('button', { name: /enviar/i }));

    expect(handleUserReport).toHaveBeenCalledWith('ajuste o CORS');
    expect(input).toHaveValue('');
  });

  it('envia a mensagem ao pressionar Enter', async () => {
    const handleUserReport = vi.fn();
    const user = userEvent.setup();
    render(<TerminalTab s={makeState([], { handleUserReport })} />);

    await user.type(screen.getByLabelText('Mensagem para o agente'), 'corrija o login{Enter}');
    expect(handleUserReport).toHaveBeenCalledWith('corrija o login');
  });

  it('desabilita o campo e o botão de enviar durante uma execução', () => {
    render(<TerminalTab s={makeState([], { isExecuting: true })} />);
    expect(screen.getByLabelText('Mensagem para o agente')).toBeDisabled();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });
});
