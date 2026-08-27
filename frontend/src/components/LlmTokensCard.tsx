import { formatTokens, pct } from '../utils/modelLimits';
import type { AppState } from '../hooks/useForjaApp';

export function LlmTokensCard({ s }: { s: AppState }) {
  const modelOk = s.llmProbe?.ok === true;
  const sessionPct = pct(s.tokenStats.total, s.tokenQuota);
  const lastTotal = s.tokenStats.last?.total || 0;
  const promptShare = s.tokenStats.total > 0 ? Math.round((s.tokenStats.prompt / s.tokenStats.total) * 100) : 0;
  const completionShare = s.tokenStats.total > 0 ? 100 - promptShare : 0;

  return (
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
          disabled={s.providerLocked}
          title={s.providerLocked ? 'Fixo até o fim desta execução — o servidor ignora trocas em runs em andamento' : undefined}
          onChange={(e) => {
            const v = e.target.value as 'gemini' | 'claude' | 'openai' | 'ollama' | 'cursor';
            s.setLlmProvider(v);
            s.setUseOllama(v === 'ollama');
          }}
        >
          <option value="gemini">Gemini</option>
          <option value="claude">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama</option>
          <option value="cursor">Cursor</option>
        </select>
        {s.providerLocked && <p className="field-hint">Fixo até o fim desta execução</p>}
      </div>
      {s.llmProvider === 'ollama' && (
        <select
          value={s.ollamaModel}
          onChange={(e) => s.setOllamaModel(e.target.value)}
          aria-label="Modelo Ollama"
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
          aria-label="Modelo OpenAI"
          style={{ width: '100%', marginBottom: 8 }}
        />
      )}
      {s.llmProvider === 'claude' && (
        <input
          value={s.claudeModel}
          onChange={(e) => s.setClaudeModel(e.target.value)}
          placeholder="claude-sonnet-4-20250514"
          aria-label="Modelo Claude"
          style={{ width: '100%', marginBottom: 8 }}
        />
      )}
      {s.llmProvider === 'cursor' && (
        <input
          value={s.cursorModel}
          onChange={(e) => s.setCursorModel(e.target.value)}
          placeholder="auto"
          aria-label="Modelo Cursor"
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
  );
}
