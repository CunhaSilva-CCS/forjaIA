import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TerminalTab } from './TerminalTab';
import type { AppState } from '../../hooks/useForjaApp';
import type { LogLine } from '../../types/agent';

function makeState(logs: LogLine[]): AppState {
  return {
    logs,
    logsEndRef: { current: null }
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
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
});
