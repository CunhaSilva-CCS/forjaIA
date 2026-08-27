import { Flame, RefreshCw, Square } from 'lucide-react';
import type { AppState } from '../hooks/useForjaApp';

export function AppHeader({ s }: { s: AppState }) {
  const activeModelName =
    s.llmProvider === 'ollama'
      ? s.ollamaModel
      : s.llmProvider === 'openai'
        ? s.openaiModel
        : s.llmProvider === 'claude'
          ? s.claudeModel
          : s.geminiModel || 'gemini-3.6-flash';
  const modelOk = s.llmProbe?.ok === true;
  const apiLabel = `API ${s.serviceStatus?.online ? 'online' : 'off'}${s.serviceStatus?.port ? ` :${s.serviceStatus.port}` : ''}`;
  const dockerLabel = `Docker ${s.dockerActive ? 'ok' : 'off'}`;
  const ollamaLabel = `Ollama ${s.ollamaOnline ? 'ok' : 'off'}`;
  const cursorLabel = `Cursor ${s.cursorOnline ? 'ok' : 'off'}`;
  const wsLabel = `WebSocket ${s.wsConnected ? 'online' : 'offline'}`;

  return (
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
        <div className="infra-dots" role="status" aria-label="Infraestrutura">
          <span className={`infra-dot ${s.serviceStatus?.online ? 'on' : ''}`} title={apiLabel} aria-label={apiLabel} />
          <span className={`infra-dot ${s.dockerActive ? 'on' : ''}`} title={dockerLabel} aria-label={dockerLabel} />
          <span className={`infra-dot ${s.ollamaOnline ? 'on' : ''}`} title={ollamaLabel} aria-label={ollamaLabel} />
          <span className={`infra-dot ${s.cursorOnline ? 'on' : ''}`} title={cursorLabel} aria-label={cursorLabel} />
          <span className={`infra-dot ${s.wsConnected ? 'on' : ''}`} title={wsLabel} aria-label={wsLabel} />
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
            aria-label="Reiniciar serviço"
            onClick={() => void s.runServiceAction('restart')}
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            className="btn-tiny"
            disabled={s.serviceBusy || !s.serviceStatus?.online}
            title="Parar"
            aria-label="Parar serviço"
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
  );
}
