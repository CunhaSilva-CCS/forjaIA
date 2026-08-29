import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryTab } from './HistoryTab';
import { api } from '../../services/api';
import type { AppState } from '../../hooks/useForjaApp';
import type { RunSummary } from '../../types/agent';

vi.mock('../../services/api', () => ({
  api: {
    runs: {
      downloadExport: vi.fn(),
      downloadReportPdf: vi.fn()
    }
  }
}));

function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    project_id: null,
    prompt: 'Criar uma API de autenticação com JWT',
    status: 'completed',
    started_at: '2026-08-29T14:21:11.952Z',
    ...overrides
  };
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    runs: [],
    openRun: vi.fn(),
    showToast: vi.fn(),
    ...overrides
  } as unknown as AppState;
}

describe('HistoryTab', () => {
  it('mostra aviso quando não há execuções', () => {
    render(<HistoryTab s={makeState()} />);
    expect(screen.getByText('Nenhuma execução ainda.')).toBeInTheDocument();
  });

  it('lista as execuções com status e prompt truncado', () => {
    const runs = [makeRun({ id: 'a', status: 'completed', prompt: 'x'.repeat(200) })];
    render(<HistoryTab s={makeState({ runs })} />);
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('x'.repeat(120))).toBeInTheDocument();
  });

  it('chama openRun com o id certo ao clicar em Abrir', async () => {
    const openRun = vi.fn();
    const user = userEvent.setup();
    const runs = [makeRun({ id: 'run-42' })];
    render(<HistoryTab s={makeState({ runs, openRun })} />);

    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(openRun).toHaveBeenCalledWith('run-42');
  });

  it('chama api.runs.downloadExport com o id certo ao clicar em Export', async () => {
    vi.mocked(api.runs.downloadExport).mockResolvedValue(undefined);
    const user = userEvent.setup();
    const runs = [makeRun({ id: 'run-7' })];
    render(<HistoryTab s={makeState({ runs })} />);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(api.runs.downloadExport).toHaveBeenCalledWith('run-7');
  });

  it('achado real: mostra um toast quando o export falha, em vez de quebrar silenciosamente', async () => {
    vi.mocked(api.runs.downloadExport).mockRejectedValue(new Error('rede caiu'));
    const showToast = vi.fn();
    const user = userEvent.setup();
    const runs = [makeRun({ id: 'run-7' })];
    render(<HistoryTab s={makeState({ runs, showToast })} />);

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('rede caiu'));
  });

  it('chama api.runs.downloadReportPdf com o id certo ao clicar em PDF', async () => {
    vi.mocked(api.runs.downloadReportPdf).mockResolvedValue(undefined);
    const user = userEvent.setup();
    const runs = [makeRun({ id: 'run-9' })];
    render(<HistoryTab s={makeState({ runs })} />);

    await user.click(screen.getByRole('button', { name: 'PDF' }));
    expect(api.runs.downloadReportPdf).toHaveBeenCalledWith('run-9');
  });

  it('mostra um toast quando a geração do PDF falha', async () => {
    vi.mocked(api.runs.downloadReportPdf).mockRejectedValue(new Error('sem relatório ainda'));
    const showToast = vi.fn();
    const user = userEvent.setup();
    const runs = [makeRun({ id: 'run-9' })];
    render(<HistoryTab s={makeState({ runs, showToast })} />);

    await user.click(screen.getByRole('button', { name: 'PDF' }));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('sem relatório ainda'));
  });

  it('renderiza múltiplas execuções, cada uma com seus próprios botões', () => {
    const runs = [makeRun({ id: 'a', status: 'completed' }), makeRun({ id: 'b', status: 'failed' })];
    render(<HistoryTab s={makeState({ runs })} />);
    expect(screen.getAllByRole('button', { name: 'Abrir' })).toHaveLength(2);
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });
});
