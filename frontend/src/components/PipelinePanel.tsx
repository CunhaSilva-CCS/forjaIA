import type { AppState } from '../hooks/useForjaApp';
import { deriveStageDurations } from '../utils/deriveAgentStates';
import { formatDuration } from '../utils/modelLimits';

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

function RailGroup({
  s,
  agents,
  extraStepClass
}: {
  s: AppState;
  agents: readonly (readonly [string, string])[];
  extraStepClass?: (agent: string) => string;
}) {
  const durations = deriveStageDurations(s.logs);
  return (
    <div className="pipeline-rail">
      {agents.map(([agent, label]) => (
        <div
          key={agent}
          className={`rail-step ${s.agentStates[agent as keyof typeof s.agentStates]} ${
            s.activeAgent === agent ? 'active' : ''
          } ${extraStepClass ? extraStepClass(agent) : ''}`}
        >
          <div className="rail-node-col">
            <span className="rail-node" />
            <span className="rail-connector" />
          </div>
          <div className="rail-body">
            <span className="rail-label">{label}</span>
            <span className="rail-meta">
              {agent === 'healer' && s.healingAttempts > 0 && (
                <span className="rail-meta-item count" title={`${s.healingAttempts}ª tentativa de cura`}>
                  {s.healingAttempts}×
                </span>
              )}
              {durations[agent as keyof typeof durations] != null && (
                <span className="rail-meta-item">{formatDuration(durations[agent as keyof typeof durations]!)}</span>
              )}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

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
          <RailGroup s={s} agents={CREATE_AGENTS} extraStepClass={() => (s.pipelineMode === 'validate' ? 'track-inactive' : '')} />
        </div>
        <div className="pipeline-group">
          <p className="pipeline-group-label">Qualidade</p>
          <RailGroup s={s} agents={QUALITY_AGENTS} />
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
