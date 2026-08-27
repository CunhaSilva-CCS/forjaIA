import type { AppState } from '../hooks/useForjaApp';

const CREATE_AGENTS = [
  ['architect', 'Arquiteto'],
  ['coder', 'Código']
] as const;

const QUALITY_AGENTS = [
  ['qa', 'QA'],
  ['security', 'Sec'],
  ['debugger', 'Debug'],
  ['healer', 'Cura'],
  ['devops', 'Ops'],
  ['human', 'Humano'],
  ['userFix', 'Fix'],
  ['reporter', 'PDF']
] as const;

const STATUS_LABELS: Record<string, string> = {
  coding: 'Codificando',
  coder: 'Codificando',
  qa: 'Qualidade',
  security: 'Segurança',
  debugger: 'Diagnóstico',
  healer: 'Cura',
  devops: 'DevOps',
  deploy: 'Deploy',
  human: 'Teste humano',
  userFix: 'Corretor',
  prodReady: 'Checklist produção',
  report: 'Relatório',
  completed: 'Pronto para produção',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  interrupted: 'Interrompido'
};

export function PipelinePanel({ s }: { s: AppState }) {
  const statusLabel =
    s.taskStatus === 'planning'
      ? s.pipelineMode === 'validate'
        ? 'Carregando projeto'
        : 'Planejando'
      : (s.taskStatus && STATUS_LABELS[s.taskStatus]) || s.taskStatus;

  return (
    <div className="forge-panel agents-board">
      <h3 className="panel-title">Pipeline</h3>
      <div className={`pipeline-track ${s.pipelineMode === 'validate' ? 'mode-validate' : 'mode-forge'}`}>
        <div className="pipeline-group">
          <p className="pipeline-group-label">Criação</p>
          <div className="agents-list agents-create">
            {CREATE_AGENTS.map(([agent, label]) => (
              <div
                key={agent}
                className={`agent-chip ${s.agentStates[agent]} ${s.activeAgent === agent ? 'pulse' : ''} ${
                  s.pipelineMode === 'validate' ? 'track-inactive' : ''
                }`}
              >
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="pipeline-group">
          <p className="pipeline-group-label">Qualidade</p>
          <div className="agents-list agents-ops">
            {QUALITY_AGENTS.map(([agent, label]) => (
              <div key={agent} className={`agent-chip ${s.agentStates[agent]} ${s.activeAgent === agent ? 'pulse' : ''}`}>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {s.taskStatus === 'awaiting_approval' && s.approvalMessage ? (
        <div className="approval-note">{s.approvalMessage}</div>
      ) : s.taskStatus ? (
        <p className="status-line">{statusLabel}</p>
      ) : null}
    </div>
  );
}
