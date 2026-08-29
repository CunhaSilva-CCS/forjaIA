import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditTab } from './AuditTab';
import type { AppState } from '../../hooks/useForjaApp';
import type { AuditRun } from '../../types/agent';

function makeRun(overrides: Partial<AuditRun> = {}): AuditRun {
  return {
    id: 'audit-1',
    target: 'self',
    targetPath: '/repo',
    status: 'completed',
    findings: [],
    tools: {
      semgrep: { available: true },
      npmAudit: { available: true }
    },
    summary: 'nenhum achado',
    error: null,
    startedAt: '2026-08-29T10:00:00.000Z',
    finishedAt: '2026-08-29T10:00:05.000Z',
    ...overrides
  };
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    auditRuns: [],
    auditLoading: false,
    auditTriggering: false,
    triggerAudit: vi.fn(),
    targetPath: 'deployed',
    ...overrides
  } as unknown as AppState;
}

describe('AuditTab', () => {
  it('mostra aviso quando nenhuma auditoria rodou ainda', () => {
    render(<AuditTab s={makeState()} />);
    expect(screen.getByText('Nenhuma auditoria rodada ainda.')).toBeInTheDocument();
  });

  it('dispara auditoria self ao clicar em "Auditar o ForjaIA"', async () => {
    const triggerAudit = vi.fn();
    const user = userEvent.setup();
    render(<AuditTab s={makeState({ triggerAudit })} />);

    await user.click(screen.getByRole('button', { name: 'Auditar o ForjaIA' }));
    expect(triggerAudit).toHaveBeenCalledWith('self');
  });

  it('desabilita "Auditar projeto atual" sem um destino de projeto selecionado', () => {
    render(<AuditTab s={makeState({ targetPath: 'deployed' })} />);
    expect(screen.getByRole('button', { name: 'Auditar projeto atual' })).toBeDisabled();
  });

  it('habilita e dispara auditoria de projeto quando há um destino selecionado', async () => {
    const triggerAudit = vi.fn();
    const user = userEvent.setup();
    render(<AuditTab s={makeState({ triggerAudit, targetPath: '/workspace/meu-app' })} />);

    const btn = screen.getByRole('button', { name: 'Auditar projeto atual' });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(triggerAudit).toHaveBeenCalledWith('project', '/workspace/meu-app');
  });

  it('mostra o resumo de uma run concluída e expande os achados ao clicar', async () => {
    const run = makeRun({
      summary: '2 achado(s) — 1 HIGH, 1 MEDIUM',
      findings: [
        { id: 'F1', severity: 'HIGH', title: 'Segredo exposto', file: 'a.js', line: 3, description: 'x' },
        { id: 'F2', severity: 'MEDIUM', title: 'Dependência antiga', file: 'package.json' }
      ]
    });
    const user = userEvent.setup();
    render(<AuditTab s={makeState({ auditRuns: [run] })} />);

    expect(screen.getByText('2 achado(s) — 1 HIGH, 1 MEDIUM')).toBeInTheDocument();
    expect(screen.queryByText('Segredo exposto')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ver 2 achado\(s\)/ }));
    expect(screen.getByText('Segredo exposto')).toBeInTheDocument();
    expect(screen.getByText('Dependência antiga')).toBeInTheDocument();
  });

  it('mostra o erro quando a run falhou', () => {
    const run = makeRun({ status: 'failed', summary: null, error: 'semgrep travou' });
    render(<AuditTab s={makeState({ auditRuns: [run] })} />);
    expect(screen.getByText('semgrep travou')).toBeInTheDocument();
  });

  it('mostra o motivo de uma ferramenta pulada (ex.: semgrep não instalado)', () => {
    const run = makeRun({
      tools: {
        semgrep: { available: false, skippedReason: 'semgrep não está instalado' },
        npmAudit: { available: true }
      }
    });
    render(<AuditTab s={makeState({ auditRuns: [run] })} />);
    expect(screen.getByText(/semgrep: semgrep não está instalado/)).toBeInTheDocument();
  });
});
