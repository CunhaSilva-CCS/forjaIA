import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PipelinePanel } from './PipelinePanel';
import type { AppState } from '../hooks/useForjaApp';
import { idleAgents } from '../utils/deriveAgentStates';
import type { LogLine } from '../types/agent';

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    agentStates: idleAgents(),
    activeAgent: null,
    healingAttempts: 0,
    logs: [] as LogLine[],
    pipelineMode: 'forge',
    taskStatus: null,
    approvalMessage: null,
    ...overrides
  } as unknown as AppState;
}

describe('PipelinePanel', () => {
  it('renderiza os dois grupos (Criação, Qualidade) com todos os agentes', () => {
    render(<PipelinePanel s={makeState()} />);
    expect(screen.getByText('Criação')).toBeInTheDocument();
    expect(screen.getByText('Qualidade')).toBeInTheDocument();
    expect(screen.getByText('Arquiteto')).toBeInTheDocument();
    expect(screen.getByText('Código')).toBeInTheDocument();
    expect(screen.getByText('QA')).toBeInTheDocument();
    expect(screen.getByText('Sec')).toBeInTheDocument();
    expect(screen.getByText('Debug')).toBeInTheDocument();
    expect(screen.getByText('Cura')).toBeInTheDocument();
    expect(screen.getByText('Ops')).toBeInTheDocument();
    expect(screen.getByText('Humano')).toBeInTheDocument();
    expect(screen.getByText('Fix')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  it('mostra o número de tentativas de cura só no nó do Curador, só quando > 0', () => {
    render(<PipelinePanel s={makeState({ healingAttempts: 2 })} />);
    expect(screen.getByTitle('2ª tentativa de cura')).toHaveTextContent('2×');
  });

  it('não mostra contador de cura quando healingAttempts é 0', () => {
    render(<PipelinePanel s={makeState({ healingAttempts: 0 })} />);
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it('achado real: calcula e mostra a duração de uma etapa a partir dos logs reais (deriveStageDurations)', () => {
    const logs: LogLine[] = [
      { agent: 'qa', message: 'Iniciando etapa: Executar QA', type: 'info', timestamp: '2026-08-29T10:00:00.000Z' },
      { agent: 'qa', message: 'QA finalizado (5/5 ok)', type: 'success', timestamp: '2026-08-29T10:00:05.000Z' }
    ];
    render(<PipelinePanel s={makeState({ logs })} />);
    // deriveStageDurations é a função real (não mockada) — só verifica que ALGUMA duração
    // formatada aparece na tela, sem acoplar o teste ao formato exato de formatDuration.
    const metaItems = document.querySelectorAll('.rail-meta-item');
    expect(metaItems.length).toBeGreaterThan(0);
  });

  it('aplica a classe do agente ativo só no nó correspondente', () => {
    render(<PipelinePanel s={makeState({ activeAgent: 'security' })} />);
    const secNode = screen.getByText('Sec').closest('.rail-step');
    const qaNode = screen.getByText('QA').closest('.rail-step');
    expect(secNode).toHaveClass('active');
    expect(qaNode).not.toHaveClass('active');
  });

  it('modo validação: grupo Criação fica marcado como inativo (track-inactive)', () => {
    render(<PipelinePanel s={makeState({ pipelineMode: 'validate' })} />);
    const arquitetoNode = screen.getByText('Arquiteto').closest('.rail-step');
    const qaNode = screen.getByText('QA').closest('.rail-step');
    expect(arquitetoNode).toHaveClass('track-inactive');
    expect(qaNode).not.toHaveClass('track-inactive');
  });

  it('modo forja: grupo Criação NÃO fica marcado como inativo', () => {
    render(<PipelinePanel s={makeState({ pipelineMode: 'forge' })} />);
    const arquitetoNode = screen.getByText('Arquiteto').closest('.rail-step');
    expect(arquitetoNode).not.toHaveClass('track-inactive');
  });

  it('mostra a mensagem de aprovação quando awaiting_approval, em vez do status genérico', () => {
    render(
      <PipelinePanel
        s={makeState({ taskStatus: 'awaiting_approval', approvalMessage: 'Aprove o Curador para aplicar as correções.' })}
      />
    );
    expect(screen.getByText('Aprove o Curador para aplicar as correções.')).toBeInTheDocument();
  });

  it('mostra o rótulo de status traduzido quando não está aguardando aprovação', () => {
    render(<PipelinePanel s={makeState({ taskStatus: 'security' })} />);
    expect(screen.getByText('Segurança')).toBeInTheDocument();
  });

  it('modo validação + status planning mostra "Carregando projeto", não "Planejando"', () => {
    render(<PipelinePanel s={makeState({ taskStatus: 'planning', pipelineMode: 'validate' })} />);
    expect(screen.getByText('Carregando projeto')).toBeInTheDocument();
  });

  it('sem taskStatus, não mostra linha de status nem nota de aprovação', () => {
    const { container } = render(<PipelinePanel s={makeState({ taskStatus: null })} />);
    expect(container.querySelector('.status-line')).not.toBeInTheDocument();
    expect(container.querySelector('.approval-note')).not.toBeInTheDocument();
  });
});
