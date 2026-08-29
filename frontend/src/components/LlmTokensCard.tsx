import { formatTokens, pct } from '../utils/modelLimits';
import { Dropdown } from './Dropdown';
import type { AppState } from '../hooks/useForjaApp';

const PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude', label: 'Claude' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'cursor', label: 'Cursor' }
];

/** "10:32" a partir de um ISO — hora local só, é sempre hoje/próximas horas (cooldown, ADR-017). */
function formatUntil(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

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
        <Dropdown
          id="llm-provider"
          value={s.llmProvider}
          disabled={s.providerLocked}
          ariaLabel="Provedor"
          title={s.providerLocked ? 'Fixo até o fim desta execução — o servidor ignora trocas em runs em andamento' : undefined}
          onChange={(v) => {
            const provider = v as 'gemini' | 'claude' | 'openai' | 'ollama' | 'cursor';
            s.setLlmProvider(provider);
            s.setUseOllama(provider === 'ollama');
          }}
          options={PROVIDER_OPTIONS}
        />
        {s.providerLocked && <p className="field-hint">Fixo até o fim desta execução</p>}
      </div>
      {s.llmProvider === 'ollama' && (
        <div style={{ marginBottom: 8 }}>
          <Dropdown
            value={s.ollamaModel}
            onChange={s.setOllamaModel}
            ariaLabel="Modelo Ollama"
            options={(s.ollamaModels.length ? s.ollamaModels : [s.ollamaModel]).map((m) => ({ value: m, label: m }))}
          />
        </div>
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

      <div className="token-card-head" style={{ marginTop: 4 }}>
        <span className="field-hint" style={{ margin: 0 }}>
          Uso por provedor (dado real, medido)
        </span>
        <button
          type="button"
          className="btn-link"
          disabled={s.llmUsageLoading}
          onClick={() => void s.refreshLlmUsage()}
          title="Atualizar uso"
        >
          {s.llmUsageLoading ? '…' : '↻'}
        </button>
      </div>
      <div className="llm-usage-table">
        <div className="llm-usage-row llm-usage-head">
          <span>Provedor</span>
          <span>Hoje</span>
          <span>7 dias</span>
          <span>30 dias</span>
        </div>
        {PROVIDER_OPTIONS.filter((p) => p.value !== 'cursor').map(({ value, label }) => {
          const usage = s.llmUsage?.periods[value];
          const cooldown = s.llmUsage?.cooldowns.find((c) => c.provider === value);
          return (
            <div key={value} className={`llm-usage-row${cooldown ? ' cooled-down' : ''}`}>
              <span className="llm-usage-provider">
                {label}
                {cooldown && (
                  <>
                    <span className="badge-cooldown" title={cooldown.reason}>
                      sem crédito até {formatUntil(cooldown.until)}
                    </span>
                    <button
                      type="button"
                      className="btn-link llm-usage-reset"
                      onClick={() => void s.clearProviderCooldown(value)}
                      title="Já recarreguei o crédito — voltar a usar este provedor"
                    >
                      resetar
                    </button>
                  </>
                )}
              </span>
              <span>{formatTokens(usage?.today.tokens ?? 0)}</span>
              <span>{formatTokens(usage?.week.tokens ?? 0)}</span>
              <span>{formatTokens(usage?.month.tokens ?? 0)}</span>
            </div>
          );
        })}
      </div>
      <p className="field-hint">
        Nenhum provedor expõe saldo de crédito por API — ForjaIA reage a falhas de billing
        pausando automaticamente o provedor por um tempo, sem adivinhar o saldo.
      </p>

      <div className="token-bar stacked session" title={`Sessão ${sessionPct}%`}>
        <div className="seg prompt" style={{ width: `${promptShare}%` }} />
        <div className="seg completion" style={{ width: `${completionShare}%` }} />
      </div>
      <div className="token-meta-row">
        <span>
          Esta run: {formatTokens(s.tokenStats.total)} / {formatTokens(s.tokenQuota)}
        </span>
        <span className="muted">
          {s.tokenStats.calls || 0} calls · ctx {formatTokens(lastTotal)}
        </span>
      </div>
      {(s.tokenStats.estimatedCostUsd || 0) > 0 && (
        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Gasto estimado nesta run: ${s.tokenStats.estimatedCostUsd!.toFixed(2)}
          {s.budgetUsd?.trim() ? ` de $${Number(s.budgetUsd).toFixed(2)}` : ''}
        </p>
      )}
    </div>
  );
}
