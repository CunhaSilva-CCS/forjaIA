import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bug,
  Check,
  CheckCircle,
  CloudLightning,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  Flame,
  Link2,
  Play,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Zap
} from 'lucide-react';
import { TokenGate } from './components/TokenGate';
import { getStoredToken } from './config';
import { useForjaApp } from './hooks/useForjaApp';
import { api } from './services/api';
import { lineDiff } from './utils/diff';
import { formatTokens, pct } from './utils/modelLimits';
import './App.css';

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getStoredToken()));
  if (!authed) return <TokenGate onReady={() => setAuthed(true)} />;
  return <Dashboard />;
}

function Dashboard() {
  const s = useForjaApp();
  const selectedFile = s.files.find((f) => f.path === s.selectedFilePath);
  const sessionPct = pct(s.tokenStats.total, s.tokenQuota);
  const activeModelName =
    s.llmProvider === 'ollama'
      ? s.ollamaModel
      : s.llmProvider === 'openai'
        ? s.openaiModel
        : s.llmProvider === 'claude'
          ? s.claudeModel
          : s.geminiModel || 'gemini-3.6-flash';
  const modelOk = s.llmProbe?.ok === true;
  const lastTotal = s.tokenStats.last?.total || 0;
  const promptShare =
    s.tokenStats.total > 0 ? Math.round((s.tokenStats.prompt / s.tokenStats.total) * 100) : 0;
  const completionShare = s.tokenStats.total > 0 ? 100 - promptShare : 0;

  const prevContent =
    s.fileVersions.length >= 2 ? s.fileVersions[s.fileVersions.length - 2].content : '';
  const currContent =
    s.fileVersions.length >= 1
      ? s.fileVersions[s.fileVersions.length - 1].content
      : selectedFile?.content || '';
  const diffRows = s.showDiff ? lineDiff(prevContent, currContent) : [];

  return (
    <div className="app-container">
      {s.toast && <div className="forge-panel toast">{s.toast}</div>}

      <header className="forge-panel app-header">
        <div className="brand">
          <div className="brand-mark">
            <Flame size={18} />
          </div>
          <div>
            <h1>ForjaIA</h1>
            <p>Forja local</p>
          </div>
        </div>
        <div className="status-row">
          {s.teamMe && (
            <span className="status-badge" title={`Papel: ${s.teamMe.role}`}>
              {s.teamMe.name}
            </span>
          )}
          <div className="infra-dots" aria-label="Infraestrutura">
            <span
              className={`infra-dot ${s.serviceStatus?.online ? 'on' : ''}`}
              title={`API ${s.serviceStatus?.online ? 'online' : 'off'}${s.serviceStatus?.port ? ` :${s.serviceStatus.port}` : ''}`}
            />
            <span
              className={`infra-dot ${s.dockerActive ? 'on' : ''}`}
              title={`Docker ${s.dockerActive ? 'ok' : 'off'}`}
            />
            <span
              className={`infra-dot ${s.ollamaOnline ? 'on' : ''}`}
              title={`Ollama ${s.ollamaOnline ? 'ok' : 'off'}`}
            />
            <span
              className={`infra-dot ${s.wsConnected ? 'on' : ''}`}
              title={`WebSocket ${s.wsConnected ? 'online' : 'offline'}`}
            />
          </div>
          <span
            className={`status-badge model-status-badge ${modelOk ? 'ok' : s.llmProbe && !s.llmProbe.ok ? 'bad' : ''}`}
            title={s.llmProbe?.detail || 'Verificando modelo…'}
          >
            <span className={`status-indicator ${modelOk ? 'active' : ''}`} />
            {s.llmProbeLoading ? 'LLM…' : s.llmProbe?.model || activeModelName}
          </span>
          <div className="service-header-actions" role="group" aria-label="Controle do serviço">
            <button
              type="button"
              className="btn-tiny"
              disabled={s.serviceBusy || Boolean(s.serviceStatus?.online)}
              title="Iniciar"
              onClick={() => void s.runServiceAction('start')}
            >
              Start
            </button>
            <button
              type="button"
              className="btn-tiny"
              disabled={s.serviceBusy}
              title="Reiniciar"
              onClick={() => void s.runServiceAction('restart')}
            >
              <RefreshCw size={12} />
            </button>
            <button
              type="button"
              className="btn-tiny"
              disabled={s.serviceBusy || !s.serviceStatus?.online}
              title="Parar"
              onClick={() => void s.runServiceAction('stop')}
            >
              <Square size={12} />
            </button>
            <button
              type="button"
              className={`btn-tiny ${s.serviceStatus?.watch?.enabled ? 'is-on' : ''}`}
              disabled={s.serviceBusy || Boolean(s.serviceStatus?.watch?.enabled)}
              title="Watchdog auto-restart"
              onClick={() => void s.runServiceAction('watch')}
            >
              Auto
            </button>
          </div>
        </div>
      </header>

      <div className="dashboard-grid">
        <div className="col-left">
          <div className="forge-panel prompt-panel">
            <h3 className="panel-title">Ordem</h3>
            <textarea
              value={s.prompt}
              onChange={(e) => s.setPrompt(e.target.value)}
              disabled={s.isExecuting}
              rows={3}
              placeholder="Descreva o software a forjar…"
            />

            <div className="field">
              <label htmlFor="project-select">Projeto</label>
              <select
                id="project-select"
                value={s.selectedProjectId || ''}
                disabled={s.isExecuting}
                onChange={(e) => {
                  void s.selectProject(e.target.value || null);
                }}
              >
                <option value="">— escolher pasta do workspace —</option>
                {s.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.source === 'workspace' ? ' · workspace' : ''}
                    {!p.existsOnDisk ? ' · pasta ausente' : ''}
                  </option>
                ))}
              </select>
              {s.projects.length === 0 ? (
                <div className="empty-projects">Nenhuma pasta no workspace.</div>
              ) : (
                <p className="field-hint">{s.projects.length} projeto(s)</p>
              )}
            </div>

            <div className="field">
              <label htmlFor="target-path">Destino</label>
              <div className="field-row">
                <input
                  id="target-path"
                  value={s.targetPath}
                  onChange={(e) => s.setTargetPath(e.target.value)}
                  disabled={s.isExecuting}
                  placeholder="ex: rag-profissional"
                />
                <button type="button" onClick={s.openFolderBrowser} disabled={s.isExecuting}>
                  Navegar
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="environment">Ambiente</label>
              <select
                id="environment"
                value={s.environment}
                disabled={s.isExecuting}
                onChange={(e) => s.setEnvironment(e.target.value as 'local' | 'staging')}
              >
                <option value="local">local (:5100)</option>
                <option value="staging">staging (:5200)</option>
              </select>
            </div>

            <div className="actions-row">
              {s.taskStatus === 'awaiting_approval' ? (
                <button className="btn-primary" onClick={s.handleApprove} disabled={s.isExecuting} style={{ flex: 1 }}>
                  <Check size={16} /> {s.approveButtonLabel}
                </button>
              ) : (
                <>
                  <button
                    className="btn-primary"
                    onClick={s.handleRun}
                    disabled={s.isExecuting || !s.prompt.trim()}
                    style={{ flex: 1 }}
                    title="Criar do zero: Arquiteto → Codificador → qualidade"
                  >
                    <Play size={16} /> Forjar
                  </button>
                  <button
                    onClick={s.handleValidateExisting}
                    disabled={s.isExecuting || !s.targetPath?.trim()}
                    title="Projeto pronto: Qualidade → Segurança → … → Humano → Reporter"
                  >
                    Validar pronto
                  </button>
                </>
              )}
              {(s.isExecuting || s.taskStatus === 'awaiting_approval') && (
                <button onClick={s.handleCancel} title="Cancelar">
                  <Square size={16} />
                </button>
              )}
            </div>

            {(s.currentRunId || s.deployUrl || s.files?.length > 0) && (
              <div className="field user-report-field">
                <label htmlFor="user-error-report">Erro na tela</label>
                <div className="user-report-row">
                  <textarea
                    id="user-error-report"
                    rows={1}
                    value={s.userErrorReport}
                    onChange={(e) => s.setUserErrorReport(e.target.value)}
                    disabled={s.isExecuting}
                    placeholder="Descreva o erro visto…"
                  />
                  <button
                    type="button"
                    onClick={s.handleUserReport}
                    disabled={s.isExecuting || !s.userErrorReport.trim()}
                    title="Enfileira o Corretor de Erros do Usuário"
                  >
                    Corrigir
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="forge-panel agents-board">
            <h3 className="panel-title">Pipeline</h3>
            <div className={`pipeline-track ${s.pipelineMode === 'validate' ? 'mode-validate' : 'mode-forge'}`}>
              <div className="pipeline-group">
                <p className="pipeline-group-label">Criação</p>
                <div className="agents-list agents-create">
                  {([
                    ['architect', 'Arquiteto'],
                    ['coder', 'Código']
                  ] as const).map(([agent, label]) => (
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
                  {([
                    ['qa', 'QA'],
                    ['security', 'Sec'],
                    ['debugger', 'Debug'],
                    ['healer', 'Cura'],
                    ['devops', 'Ops'],
                    ['human', 'Humano'],
                    ['userFix', 'Fix'],
                    ['reporter', 'PDF']
                  ] as const).map(([agent, label]) => (
                    <div
                      key={agent}
                      className={`agent-chip ${s.agentStates[agent]} ${s.activeAgent === agent ? 'pulse' : ''}`}
                    >
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {s.taskStatus === 'awaiting_approval' && s.approvalMessage ? (
              <div className="approval-note">{s.approvalMessage}</div>
            ) : s.taskStatus ? (
              <p className="status-line">
                {(
                  {
                    planning: s.pipelineMode === 'validate' ? 'Carregando projeto' : 'Planejando',
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
                  } as Record<string, string>
                )[s.taskStatus] || s.taskStatus}
              </p>
            ) : null}
          </div>
        </div>

        <div className="col-center forge-panel">
          <div className="tabs">
            {(
              [
                ['terminal', TerminalIcon, 'Terminal'],
                ['code', Code2, 'Código'],
                ['security', ShieldAlert, 'Segurança'],
                ['diagnosis', Bug, 'Diagnóstico'],
                ['metrics', Activity, 'Métricas'],
                ['adrs', FileText, 'ADRs'],
                ['history', RefreshCw, 'Histórico'],
                ['projects', Settings, 'Projetos'],
                ['team', Settings, 'Equipe']
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                className={s.currentTab === id ? 'active' : ''}
                onClick={() => s.setCurrentTab(id)}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          <div className="tab-body">
            {s.currentTab === 'terminal' && (
              <div className="terminal">
                {s.logs.map((log, i) => (
                  <div key={i} className={`log-line ${log.type}`}>
                    <span className="log-agent">[{log.agent}]</span> {log.message}
                  </div>
                ))}
                <div ref={s.logsEndRef} />
              </div>
            )}

            {s.currentTab === 'code' && (
              <div className="code-explorer">
                <div className="file-list">
                  {s.files.map((f) => (
                    <button
                      key={f.path}
                      className={s.selectedFilePath === f.path ? 'active' : ''}
                      onClick={() => {
                        s.setSelectedFilePath(f.path);
                        s.setShowDiff(false);
                      }}
                    >
                      {f.path}
                    </button>
                  ))}
                </div>
                <div className="file-content">
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <button onClick={s.loadDiff} disabled={!s.currentRunId || !s.selectedFilePath}>
                      Diff das versões
                    </button>
                    {s.showDiff && (
                      <button onClick={() => s.setShowDiff(false)}>Ver arquivo</button>
                    )}
                    {s.currentRunId && (
                      <>
                        <a className="btn-link" href={api.runs.exportUrl(s.currentRunId)}>
                          Exportar ZIP
                        </a>
                        <a className="btn-link" href={api.runs.reportPdfUrl(s.currentRunId)}>
                          Relatório PDF
                        </a>
                      </>
                    )}
                  </div>
                  {s.showDiff ? (
                    <pre className="diff-view">
                      {diffRows.map((row, i) => (
                        <div key={i} className={`diff-${row.type}`}>
                          {row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : '  '}
                          {row.text}
                        </div>
                      ))}
                    </pre>
                  ) : (
                    <pre>
                      <code>{selectedFile?.content || '// selecione um arquivo'}</code>
                    </pre>
                  )}
                </div>
              </div>
            )}

            {s.currentTab === 'security' && (
              <div className="cards-stack">
                {s.securityIssues.length === 0 && <p className="muted">Nenhum problema ainda.</p>}
                {s.securityIssues.map((issue) => (
                  <div key={issue.id} className="issue-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{issue.title}</strong>
                      <span className={`sev ${issue.severity?.toLowerCase()}`}>{issue.severity}</span>
                    </div>
                    <p>{issue.description}</p>
                    <p className="muted">{issue.remediation}</p>
                  </div>
                ))}
              </div>
            )}

            {s.currentTab === 'diagnosis' && (
              <div className="cards-stack">
                {!s.diagnosis && <p className="muted">Aguardando diagnóstico do Depurador Sênior…</p>}
                {s.diagnosis && (
                  <>
                    <div className="issue-card diagnosis-summary">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <strong>Resumo</strong>
                        <span className={`sev ${s.diagnosis.severity?.toLowerCase()}`}>
                          {s.diagnosis.severity}
                        </span>
                      </div>
                      <p>{s.diagnosis.summary}</p>
                      {s.diagnosis.notesForHealer && (
                        <p className="muted">Para o Curador: {s.diagnosis.notesForHealer}</p>
                      )}
                    </div>
                    {(s.diagnosis.rootCauses || []).map((rc) => (
                      <div key={rc.id} className="issue-card">
                        <strong>
                          {rc.id}: {rc.title}
                        </strong>
                        <p className="muted">
                          Confiança {(rc.confidence * 100).toFixed(0)}% · {rc.evidence}
                        </p>
                        {rc.affectedFiles?.length > 0 && (
                          <p className="muted">Arquivos: {rc.affectedFiles.join(', ')}</p>
                        )}
                      </div>
                    ))}
                    {(s.diagnosis.recommendedFixes || []).map((fix, i) => (
                      <div key={i} className="issue-card">
                        <strong>
                          Fix #{fix.priority}: {fix.action}
                        </strong>
                        {fix.files?.length > 0 && (
                          <p className="muted">{fix.files.join(', ')}</p>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {s.currentTab === 'metrics' && (
              <div>
                {s.performanceMetrics ? (
                  <div className="metrics-grid">
                    <div><Zap size={16} /> RPS: {s.performanceMetrics.rps}</div>
                    <div><Activity size={16} /> Latência: {s.performanceMetrics.avgLatency}ms</div>
                    <div><CheckCircle size={16} /> Sucesso: {s.performanceMetrics.successRate}%</div>
                    <div><CloudLightning size={16} /> Requisições: {s.performanceMetrics.totalRequests}</div>
                    {s.performanceMetrics.chaosMode && (
                      <p className="muted">
                      Caos:{' '}
                      {s.performanceMetrics.chaosMode === 'client-side-fault-injection' ||
                      s.performanceMetrics.chaosMode === 'injecao-falhas-cliente'
                        ? 'injeção de falhas no cliente'
                        : s.performanceMetrics.chaosMode}
                    </p>
                    )}
                  </div>
                ) : (
                  <p className="muted">As métricas aparecem após a fase DevOps.</p>
                )}
                <div style={{ marginTop: 16 }}>
                  {s.chaosEvents.map((c, i) => (
                    <div key={i} className="log-line warning">
                      <AlertTriangle size={12} /> {c.name}: {c.log}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {s.currentTab === 'adrs' && (
              <div className="cards-stack">
                {s.taskStatus === 'awaiting_approval' && (
                  <p className="muted">Edite os ADRs antes de aprovar a arquitetura.</p>
                )}
                {s.adrs.map((adr, idx) => (
                  <div key={adr.id} className="issue-card">
                    <input
                      value={adr.title}
                      disabled={s.taskStatus !== 'awaiting_approval'}
                      onChange={(e) => {
                        const next = [...s.adrs];
                        next[idx] = { ...adr, title: e.target.value };
                        s.setAdrs(next);
                      }}
                      style={{ width: '100%', fontWeight: 600, marginBottom: 8 }}
                    />
                    <label className="muted">Decisão</label>
                    <textarea
                      value={adr.decision}
                      disabled={s.taskStatus !== 'awaiting_approval'}
                      onChange={(e) => {
                        const next = [...s.adrs];
                        next[idx] = { ...adr, decision: e.target.value };
                        s.setAdrs(next);
                      }}
                      rows={3}
                      style={{ width: '100%' }}
                    />
                    <label className="muted">Consequências</label>
                    <textarea
                      value={adr.consequences}
                      disabled={s.taskStatus !== 'awaiting_approval'}
                      onChange={(e) => {
                        const next = [...s.adrs];
                        next[idx] = { ...adr, consequences: e.target.value };
                        s.setAdrs(next);
                      }}
                      rows={2}
                      style={{ width: '100%' }}
                    />
                  </div>
                ))}
                {s.adrs.length === 0 && <p className="muted">Nenhum ADR ainda.</p>}
              </div>
            )}

            {s.currentTab === 'history' && (
              <div className="cards-stack">
                {s.runs.map((run) => (
                  <div key={run.id} className="issue-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <strong>{run.status}</strong>
                      <p style={{ fontSize: 13 }}>{run.prompt.slice(0, 120)}</p>
                      <p className="muted">{run.started_at}</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button onClick={() => s.openRun(run.id)}>Abrir</button>
                      <a className="btn-link" href={api.runs.exportUrl(run.id)}>
                        Export
                      </a>
                      <a className="btn-link" href={api.runs.reportPdfUrl(run.id)}>
                        PDF
                      </a>
                    </div>
                  </div>
                ))}
                {s.runs.length === 0 && <p className="muted">Nenhuma execução ainda.</p>}
              </div>
            )}

            {s.currentTab === 'projects' && (
              <div>
                <div className="issue-card" style={{ marginBottom: 12 }}>
                  <h4>Novo projeto</h4>
                  <input
                    placeholder="Nome"
                    value={s.newProjectName}
                    onChange={(e) => s.setNewProjectName(e.target.value)}
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                  <input
                    placeholder="Caminho relativo no workspace"
                    value={s.newProjectPath}
                    onChange={(e) => s.setNewProjectPath(e.target.value)}
                    style={{ width: '100%', marginBottom: 8 }}
                  />
                  <button className="btn-primary" onClick={s.createProject} disabled={!s.newProjectName.trim()}>
                    <Plus size={14} /> Criar
                  </button>
                </div>
                {s.projects.map((p) => (
                  <div key={p.id} className="issue-card" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <strong>{p.name}</strong>
                      <p className="muted">
                        {p.path}
                        {p.source === 'workspace' ? ' · pasta do workspace' : ' · registrado'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => void s.selectProject(p.id)}>Usar</button>
                      {p.source === 'registered' && !String(p.id).startsWith('ws:') && (
                        <button
                          onClick={async () => {
                            await api.projects.remove(p.id);
                            s.refreshMeta();
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {s.projects.length === 0 && (
                  <p className="muted">Nenhum projeto. Crie acima ou adicione pastas em workspace/.</p>
                )}
              </div>
            )}

            {s.currentTab === 'team' && (
              <div className="cards-stack">
                <div className="issue-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>Célula de produção</strong>
                    <button type="button" onClick={() => void s.refreshTeamBoard()}>
                      Atualizar
                    </button>
                  </div>
                  <p className="muted" style={{ marginTop: 6 }}>
                    Você: {s.teamMe ? `${s.teamMe.name} (${s.teamMe.role})` : '—'}
                    {s.serviceStatus
                      ? ` · API ${s.serviceStatus.online ? 'online' : 'off'} :${s.serviceStatus.port}`
                      : ''}
                  </p>
                  {(s.teamInfo?.members || []).map((m: any) => (
                    <div key={m.id} className="log-line" style={{ marginTop: 4 }}>
                      <strong>{m.name}</strong> · {m.role}
                      {m.tokenHint ? <span className="muted"> · {m.tokenHint}</span> : null}
                    </div>
                  ))}
                  {s.teamInfo?.bootstrapTokens && (
                    <p className="muted" style={{ marginTop: 8, fontSize: 11 }}>
                      Tokens bootstrap (local): lead / qa / sre — veja API `/api/team` ou logs do seed.
                      {s.teamInfo.bootstrapTokens.note ? ` ${s.teamInfo.bootstrapTokens.note}` : ''}
                    </p>
                  )}
                </div>

                <div className="issue-card">
                  <strong>Fila ({s.teamBoard.queued?.length || 0})</strong>
                  {(s.teamBoard.queued || []).length === 0 && <p className="muted">Vazia</p>}
                  {(s.teamBoard.queued || []).map((r: any) => (
                    <div key={r.id} className="log-line">
                      #{r.queue_position || '—'} {r.owner_name || '—'} · {String(r.prompt || '').slice(0, 80)}
                    </div>
                  ))}
                </div>

                <div className="issue-card">
                  <strong>Aguardando aprovação ({s.teamBoard.awaiting?.length || 0})</strong>
                  {(s.teamBoard.awaiting || []).length === 0 && <p className="muted">Nenhum gate aberto</p>}
                  {(s.teamBoard.awaiting || []).map((r: any) => (
                    <div key={r.id} className="log-line">
                      {r.owner_name || '—'} · {r.config?.pendingNextStage || '—'} · {String(r.prompt || '').slice(0, 60)}
                    </div>
                  ))}
                </div>

                <div className="issue-card">
                  <strong>Papéis × etapas</strong>
                  {s.teamInfo?.stageRoles &&
                    Object.entries(s.teamInfo.stageRoles).map(([stage, roles]) => (
                      <div key={stage} className="log-line muted" style={{ fontSize: 12 }}>
                        {stage}: {(roles as string[]).join(', ')}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="col-right">
          <div className={`forge-panel side-block deploy-card ${s.deployUrl ? 'is-live' : 'is-idle'}`}>
            <div className="deploy-card-head">
              <h3>
                <Link2 size={16} /> Deploy
              </h3>
              <span className={`deploy-pill ${s.deployUrl ? 'live' : 'idle'}`}>
                {s.taskStatus === 'completed' ? 'produção' : s.deployUrl ? 'ao vivo' : '—'}
              </span>
            </div>

            {s.deployUrl ? (
              <>
                <a
                  className="deploy-url"
                  href={s.deployUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={s.deployUrl}
                >
                  {s.deployUrl.replace(/^https?:\/\//, '')}
                </a>
                <div className="deploy-actions">
                  <a className="deploy-btn primary" href={s.deployUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> Abrir
                  </a>
                  <button
                    type="button"
                    className="deploy-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(s.deployUrl!);
                        s.showToast('URL copiada');
                      } catch {
                        s.showToast('Não foi possível copiar');
                      }
                    }}
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </>
            ) : (
              <p className="deploy-idle-copy muted">Aparece após o deploy.</p>
            )}
          </div>

          <div className="forge-panel side-block">
            <div className="panel-head-row">
              <h3>Testes</h3>
              {s.currentRunId && (
                <a className="btn-link" href={api.runs.reportPdfUrl(s.currentRunId)}>
                  PDF
                </a>
              )}
            </div>
            {s.tests.map((t, i) => (
              <div key={i} className="log-line compact">
                {t.passed ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {t.name}
              </div>
            ))}
            {s.tests.length === 0 && <p className="muted">Sem testes ainda.</p>}
          </div>

          <div className="forge-panel side-block token-card">
            <div className="token-card-head">
              <h3>LLM & tokens</h3>
              <button
                type="button"
                className="btn-link"
                disabled={s.llmProbeLoading}
                onClick={() => void s.refreshLlmProbe(s.llmProvider)}
                title={s.llmProbe?.detail || 'Verificar modelo'}
              >
                {s.llmProbeLoading ? '…' : modelOk ? 'ok' : 'off'}
              </button>
            </div>

            <div className="field">
              <label htmlFor="llm-provider">Provedor</label>
              <select
                id="llm-provider"
                value={s.llmProvider}
                onChange={(e) => {
                  const v = e.target.value as 'gemini' | 'claude' | 'openai' | 'ollama';
                  s.setLlmProvider(v);
                  s.setUseOllama(v === 'ollama');
                }}
              >
                <option value="gemini">Gemini</option>
                <option value="claude">Claude</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
            {s.llmProvider === 'ollama' && (
              <select
                value={s.ollamaModel}
                onChange={(e) => s.setOllamaModel(e.target.value)}
                style={{ width: '100%', marginBottom: 8 }}
              >
                {(s.ollamaModels.length ? s.ollamaModels : [s.ollamaModel]).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            {s.llmProvider === 'openai' && (
              <input
                value={s.openaiModel}
                onChange={(e) => s.setOpenaiModel(e.target.value)}
                placeholder="gpt-4.1"
                style={{ width: '100%', marginBottom: 8 }}
              />
            )}
            {s.llmProvider === 'claude' && (
              <input
                value={s.claudeModel}
                onChange={(e) => s.setClaudeModel(e.target.value)}
                placeholder="claude-sonnet-4-20250514"
                style={{ width: '100%', marginBottom: 8 }}
              />
            )}

            <div className="token-bar stacked session" title={`Sessão ${sessionPct}%`}>
              <div className="seg prompt" style={{ width: `${promptShare}%` }} />
              <div className="seg completion" style={{ width: `${completionShare}%` }} />
            </div>
            <div className="token-meta-row">
              <span>
                {formatTokens(s.tokenStats.total)} / {formatTokens(s.tokenQuota)}
              </span>
              <span className="muted">
                {s.tokenStats.calls || 0} calls · ctx {formatTokens(lastTotal)}
              </span>
            </div>
          </div>

          <div className="forge-panel side-block">
            <h3>Regras</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={s.newRule}
                onChange={(e) => s.setNewRule(e.target.value)}
                placeholder="Nova regra"
                style={{ flex: 1 }}
              />
              <button
                onClick={() => {
                  if (!s.newRule.trim()) return;
                  const updated = [...s.styleRules, s.newRule.trim()];
                  s.setNewRule('');
                  s.saveRules(updated);
                }}
              >
                <Plus size={14} />
              </button>
            </div>
            <button
              type="button"
              className="btn-ghost-full"
              onClick={async () => {
                try {
                  const res = await api.preferences.resetSenior();
                  s.setStyleRules(res.data?.styleRules || []);
                  s.showToast(res.message || 'Regras elite restauradas');
                } catch (err) {
                  s.showToast(err instanceof Error ? err.message : 'Falha ao restaurar regras');
                }
              }}
            >
              Restaurar elite
            </button>
            <ul className="rules-list">
              {s.styleRules.map((rule, i) => (
                <li key={i}>
                  <span>{rule}</span>
                  <button type="button" onClick={() => s.saveRules(s.styleRules.filter((_, idx) => idx !== i))}>
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
            {s.styleRules.length === 0 && (
              <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Nenhuma regra — restaure as elite.
              </p>
            )}
          </div>
        </div>
      </div>

      {s.showFolderBrowser && (
        <div className="modal-overlay" onClick={() => s.setShowFolderBrowser(false)}>
          <div className="forge-panel modal" onClick={(e) => e.stopPropagation()}>
            <h3>Navegador do workspace</h3>
            <p className="muted">Pastas relativas a:</p>
            <p style={{ fontSize: 12, wordBreak: 'break-all' }}>
              <code>{s.workspaceRoot || '…'}</code>
            </p>
            <p style={{ marginTop: 8 }}>
              Selecionado: <code>{s.currentBrowserPath}</code>
              {!s.browserExists && (
                <span style={{ color: 'var(--warning)', marginLeft: 8 }}>(ainda não existe)</span>
              )}
            </p>
            {s.browserListingPath !== s.currentBrowserPath && (
              <p className="muted">Listando conteúdo de: {s.browserListingPath}</p>
            )}
            {s.browserError && <p style={{ color: 'var(--error)' }}>{s.browserError}</p>}

            <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
              <button
                disabled={!s.parentBrowserPath || s.browserLoading}
                onClick={() => s.browseTo(s.parentBrowserPath || '.')}
              >
                ..
              </button>
              <button
                className="btn-primary"
                disabled={s.browserLoading}
                onClick={() => {
                  s.setTargetPath(s.currentBrowserPath);
                  s.setShowFolderBrowser(false);
                }}
              >
                Usar esta pasta
              </button>
              {!s.browserExists && (
                <button
                  disabled={s.browserLoading}
                  onClick={async () => {
                    try {
                      await api.mkdir(s.currentBrowserPath);
                      await s.browseTo(s.currentBrowserPath);
                    } catch (err) {
                      s.showToast(err instanceof Error ? err.message : 'Falha ao criar');
                    }
                  }}
                >
                  Criar caminho selecionado
                </button>
              )}
              <button onClick={() => s.setShowFolderBrowser(false)}>Fechar</button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                placeholder="Nova pasta (ex: deployed)"
                value={s.newFolderName}
                onChange={(e) => s.setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void s.createBrowserFolder();
                }}
                style={{ flex: 1 }}
              />
              <button disabled={s.browserLoading || !s.newFolderName.trim()} onClick={() => void s.createBrowserFolder()}>
                Criar
              </button>
            </div>

            <div className="file-list">
              {s.browserLoading && <p className="muted">Carregando…</p>}
              {!s.browserLoading && s.browserDirs.length === 0 && (
                <p className="muted">Nenhuma subpasta aqui. Crie uma acima ou use esta pasta.</p>
              )}
              {s.browserDirs.map((d) => (
                <button key={d.path} onClick={() => void s.browseTo(d.path)} disabled={s.browserLoading}>
                  {d.name}/
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
