import { Flame, RefreshCw, Square } from 'lucide-react';
import type { AppState } from '../hooks/useForjaApp';
import { formatDate } from '../utils/format';

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'OpenAI',
  ollama: 'Ollama',
  cursor: 'Cursor'
};

export function AppHeader({ s }: { s: AppState }) {
  const activeModelName =
    s.llmProvider === 'ollama'
      ? s.ollamaModel
      : s.llmProvider === 'openai'
        ? s.openaiModel
        : s.llmProvider === 'claude'
          ? s.claudeModel
          : s.llmProvider === 'cursor'
            ? s.cursorModel
            : s.geminiModel || 'gemini-3.6-flash';
  const modelOk = s.llmProbe?.ok === true;
  const modelBad = Boolean(s.llmProbe && !s.llmProbe.ok);
  const engineWorking = Boolean(s.activeAgent);
  const apiLabel = `API ${s.serviceStatus?.online ? 'online' : 'off'}${s.serviceStatus?.port ? ` :${s.serviceStatus.port}` : ''}`;
  const dockerLabel = `Docker ${s.dockerActive ? 'ok' : 'off'}`;
  const ollamaLabel = `Ollama ${s.ollamaOnline ? 'ok' : 'off'}`;
  const cursorLabel = `Cursor ${s.cursorOnline ? 'ok' : 'off'}`;
  const wsLabel = `WebSocket ${s.wsConnected ? 'online' : 'offline'}`;
  const dogfoodScheduled = Boolean(s.dogfoodStatus?.scheduled);
  const dogfoodLastRun = s.dogfoodStatus?.lastRun;
  const dogfoodOk = dogfoodScheduled && dogfoodLastRun?.outcome !== 'failed' && dogfoodLastRun?.outcome !== 'timeout';
  const dogfoodLabel = !dogfoodScheduled
    ? 'Dogfooding automático: não agendado (ver ADR-035)'
    : `Dogfooding automático: agendado (semanal)${
        dogfoodLastRun
          ? ` — última run ${dogfoodLastRun.outcome} em ${formatDate(dogfoodLastRun.finishedAt)} (${dogfoodLastRun.testsPassed ?? '?'}/${dogfoodLastRun.testsTotal ?? '?'} testes)`
          : ' — ainda sem nenhuma run registrada'
      }`;
  const engineTitle = `${PROVIDER_LABELS[s.llmProvider] || s.llmProvider} · ${s.llmProbe?.model || activeModelName}${
    engineWorking ? ' — em uso agora' : ''
  }${s.llmProbe?.detail ? `\n${s.llmProbe.detail}` : ''}`;

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
          <span
            className={`infra-dot ${dogfoodScheduled ? (dogfoodOk ? 'on' : 'warn') : ''}`}
            title={dogfoodLabel}
            aria-label={dogfoodLabel}
          />
        </div>
        <div className="engine-strip" title={engineTitle} role="status" aria-label="Motor de IA em uso">
          <span className={`engine-pulse ${engineWorking ? 'live' : ''}`} />
          <span className="engine-provider">{PROVIDER_LABELS[s.llmProvider] || s.llmProvider}</span>
          <span className="engine-model">{s.llmProbeLoading ? 'verificando…' : s.llmProbe?.model || activeModelName}</span>
          <span className={`engine-health ${modelOk ? 'ok' : modelBad ? 'bad' : ''}`} />
        </div>
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
