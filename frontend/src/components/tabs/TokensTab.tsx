import { useMemo } from 'react';
import type { AppState } from '../../hooks/useForjaApp';
import { formatDate } from '../../utils/format';
import { formatTokens } from '../../utils/modelLimits';

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'OpenAI',
  ollama: 'Ollama'
};

function providerLabel(id: string | null | undefined): string {
  if (!id) return 'desconhecido';
  return PROVIDER_LABELS[id] || id;
}

export function TokensTab({ s }: { s: AppState }) {
  const stats = useMemo(() => {
    const withTokens = s.runs.filter((r) => (r.tokenStats?.total || 0) > 0);
    const totalTokens = withTokens.reduce((sum, r) => sum + (r.tokenStats?.total || 0), 0);
    const totalCalls = withTokens.reduce((sum, r) => sum + (r.tokenStats?.calls || 0), 0);

    const byProvider = new Map<string, { tokens: number; calls: number; runs: number }>();
    for (const run of withTokens) {
      const provider = run.config?.llmProvider || run.tokenStats?.last?.provider || 'desconhecido';
      const entry = byProvider.get(provider) || { tokens: 0, calls: 0, runs: 0 };
      entry.tokens += run.tokenStats?.total || 0;
      entry.calls += run.tokenStats?.calls || 0;
      entry.runs += 1;
      byProvider.set(provider, entry);
    }
    const providers = [...byProvider.entries()]
      .map(([provider, v]) => ({ provider, ...v, share: totalTokens > 0 ? (v.tokens / totalTokens) * 100 : 0 }))
      .sort((a, b) => b.tokens - a.tokens);

    // s.runs vem do backend mais recente primeiro; a tendência lê melhor da mais antiga pra mais nova.
    const chronological = [...withTokens].reverse();
    const maxTokens = chronological.reduce((m, r) => Math.max(m, r.tokenStats?.total || 0), 0);

    return { withTokens, totalTokens, totalCalls, providers, chronological, maxTokens };
  }, [s.runs]);

  if (stats.withTokens.length === 0) {
    return <p className="muted">Nenhuma execução com consumo de tokens registrado ainda.</p>;
  }

  return (
    <div>
      <div className="tokens-summary">
        <div className="tokens-stat">
          <span className="tokens-stat-label">Total consumido</span>
          <span className="tokens-stat-value">{formatTokens(stats.totalTokens)}</span>
        </div>
        <div className="tokens-stat">
          <span className="tokens-stat-label">Chamadas de LLM</span>
          <span className="tokens-stat-value">{stats.totalCalls}</span>
        </div>
        <div className="tokens-stat">
          <span className="tokens-stat-label">Execuções carregadas</span>
          <span className="tokens-stat-value">{stats.withTokens.length}</span>
        </div>
        <div className="tokens-stat">
          <span className="tokens-stat-label">Média por execução</span>
          <span className="tokens-stat-value">{formatTokens(stats.totalTokens / stats.withTokens.length)}</span>
        </div>
      </div>

      <p className="panel-title tokens-section-heading">Por provedor</p>
      <div className="tokens-providers">
        {stats.providers.map((p) => (
          <div key={p.provider} className="tokens-provider-row">
            <span className="tokens-provider-name">{providerLabel(p.provider)}</span>
            <div className="tokens-provider-bar">
              <div className="tokens-provider-fill" style={{ width: `${Math.max(p.share, 2)}%` }} />
            </div>
            <span className="tokens-provider-value">
              {formatTokens(p.tokens)} · {p.runs} execuç{p.runs === 1 ? 'ão' : 'ões'}
            </span>
          </div>
        ))}
      </div>

      <p className="panel-title tokens-section-heading">Consumo por execução</p>
      <div className="tokens-trend" role="img" aria-label="Consumo de tokens por execução, da mais antiga à mais recente">
        {stats.chronological.map((run) => {
          const total = run.tokenStats?.total || 0;
          const heightPct = stats.maxTokens > 0 ? Math.max((total / stats.maxTokens) * 100, 4) : 4;
          return (
            <button
              key={run.id}
              type="button"
              className="tokens-trend-bar"
              style={{ height: `${heightPct}%` }}
              title={`${formatDate(run.started_at)} · ${formatTokens(total)} tokens · ${run.prompt.slice(0, 60)}`}
              onClick={() => s.openRun(run.id)}
            />
          );
        })}
      </div>

      <p className="panel-title tokens-section-heading">
        Histórico
        {s.runs.length >= 50 && <span className="tokens-section-note"> · últimas {s.runs.length} execuções carregadas</span>}
      </p>
      <div className="tokens-table">
        <div className="tokens-table-row tokens-table-head">
          <span>Data</span>
          <span>Provedor</span>
          <span className="tokens-num">Tokens</span>
          <span className="tokens-num">Chamadas</span>
        </div>
        {stats.withTokens.map((run) => (
          <button key={run.id} type="button" className="tokens-table-row" onClick={() => s.openRun(run.id)}>
            <span>{formatDate(run.started_at)}</span>
            <span>{providerLabel(run.config?.llmProvider || run.tokenStats?.last?.provider)}</span>
            <span className="tokens-num">{formatTokens(run.tokenStats?.total || 0)}</span>
            <span className="tokens-num">{run.tokenStats?.calls || 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
