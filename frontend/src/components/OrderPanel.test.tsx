import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderPanel } from './OrderPanel';
import type { AppState } from '../hooks/useForjaApp';

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    prompt: '',
    setPrompt: vi.fn(),
    isExecuting: false,
    selectedProjectId: null,
    selectProject: vi.fn(),
    projects: [],
    targetPath: 'deployed',
    setTargetPath: vi.fn(),
    openFolderBrowser: vi.fn(),
    environment: 'local',
    setEnvironment: vi.fn(),
    budgetUsd: '',
    setBudgetUsd: vi.fn(),
    taskStatus: null,
    approveButtonLabel: 'Aprovar',
    handleApprove: vi.fn(),
    handleRun: vi.fn(),
    handleValidateExisting: vi.fn(),
    handleCancel: vi.fn(),
    resetWorkspace: vi.fn(),
    pendingNextStage: null,
    preflightReport: null,
    forceQa: false,
    setForceQa: vi.fn(),
    qaPreflightBlocked: false,
    canApproveQa: true,
    currentRunId: null,
    deployUrl: null,
    files: [],
    userErrorReport: '',
    setUserErrorReport: vi.fn(),
    handleUserReport: vi.fn(),
    ...overrides
  } as unknown as AppState;
}

describe('OrderPanel', () => {
  it('chama resetWorkspace ao clicar em Novo', async () => {
    const resetWorkspace = vi.fn();
    const user = userEvent.setup();
    render(<OrderPanel s={makeState({ resetWorkspace })} />);

    await user.click(screen.getByRole('button', { name: /novo/i }));
    expect(resetWorkspace).toHaveBeenCalledTimes(1);
  });

  it('desabilita o botão Novo durante uma execução', () => {
    render(<OrderPanel s={makeState({ isExecuting: true })} />);
    expect(screen.getByRole('button', { name: /novo/i })).toBeDisabled();
  });

  it('lista projetos existentes e chama selectProject ao escolher um', async () => {
    const selectProject = vi.fn();
    const user = userEvent.setup();
    render(
      <OrderPanel
        s={makeState({
          selectProject,
          projects: [
            {
              id: 'p1',
              name: 'meu-app',
              path: 'meu-app',
              source: 'registered',
              existsOnDisk: true,
              created_at: '2026-08-28T00:00:00.000Z'
            }
          ]
        })}
      />
    );

    await user.click(screen.getByLabelText('Projeto'));
    await user.click(screen.getByRole('option', { name: /meu-app/ }));
    expect(selectProject).toHaveBeenCalledWith('p1');
  });

  it('achado real (ADR-024): campo de orçamento chama setBudgetUsd ao digitar', async () => {
    const setBudgetUsd = vi.fn();
    const user = userEvent.setup();
    render(<OrderPanel s={makeState({ setBudgetUsd })} />);

    await user.type(screen.getByLabelText('Orçamento (USD, opcional)'), '5');
    expect(setBudgetUsd).toHaveBeenCalledWith('5');
  });

  it('campo de orçamento fica vazio (sem teto) por padrão, sem quebrar', () => {
    render(<OrderPanel s={makeState()} />);
    expect(screen.getByLabelText('Orçamento (USD, opcional)')).toHaveValue(null);
  });

  it('bloqueia aprovação para QA quando preflight reprovado', () => {
    render(
      <OrderPanel
        s={makeState({
          taskStatus: 'awaiting_approval',
          pendingNextStage: 'qa',
          approveButtonLabel: 'Preflight reprovado — QA bloqueado',
          preflightReport: {
            passed: false,
            tests: [{ name: 'health', passed: false, error: 'timeout' }]
          },
          qaPreflightBlocked: true,
          canApproveQa: false
        })}
      />
    );
    expect(screen.getByRole('button', { name: /preflight reprovado/i })).toBeDisabled();
    expect(screen.getByLabelText(/forçar qa/i)).toBeInTheDocument();
  });

  it('permite aprovar QA com forceQa marcado', async () => {
    const handleApprove = vi.fn();
    const setForceQa = vi.fn();
    const user = userEvent.setup();
    render(
      <OrderPanel
        s={makeState({
          taskStatus: 'awaiting_approval',
          pendingNextStage: 'qa',
          approveButtonLabel: 'Aprovar QA',
          preflightReport: {
            passed: false,
            tests: [{ name: 'health', passed: false }]
          },
          qaPreflightBlocked: true,
          canApproveQa: true,
          forceQa: true,
          setForceQa,
          handleApprove
        })}
      />
    );
    const approveBtn = screen.getByRole('button', { name: /aprovar qa/i });
    expect(approveBtn).not.toBeDisabled();
    await user.click(approveBtn);
    expect(handleApprove).toHaveBeenCalledTimes(1);
  });
});
