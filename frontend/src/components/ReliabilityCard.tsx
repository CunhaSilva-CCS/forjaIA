import type { AppState } from '../hooks/useForjaApp';

function pct1(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 1000) / 10}%`;
}

export function ReliabilityCard({ s }: { s: AppState }) {
  const stats = s.reliabilityStats;
  const hasData = Boolean(stats && stats.measuredRuns > 0);

  return (
    <div className="forge-panel side-block">
      <div className="panel-head-row">
        <h3>Confiabilidade</h3>
        <button
          type="button"
          className="btn-link"
          disabled={s.reliabilityLoading}
          onClick={() => void s.refreshReliabilityStats()}
          title="Atualizar"
        >
          {s.reliabilityLoading ? '…' : '↻'}
        </button>
      </div>

      {!hasData && (
        <p className="muted">
          Ainda sem runs medidas — o número aparece assim que a primeira run chegar no Relatório.
        </p>
      )}

      {hasData && stats && (
        <>
          <div className="token-kv">
            <div>
              <span className="k">Sem intervenção</span>
              <span className="v">{pct1(stats.finishedWithoutInterventionRate)}</span>
            </div>
            <div>
              <span className="k">Runs medidas</span>
              <span className="v">{stats.measuredRuns}</span>
            </div>
            <div>
              <span className="k">Curas / run</span>
              <span className="v">{stats.avgHealingAttempts?.toFixed(1) ?? '—'}</span>
            </div>
            <div>
              <span className="k">Relato manual</span>
              <span className="v">{pct1(stats.userFixInvokedRate)}</span>
            </div>
            <div>
              <span className="k">QA aprovado</span>
              <span className="v">{pct1(stats.avgTestPassRate)}</span>
            </div>
            <div>
              <span className="k">Humano aprovou</span>
              <span className="v">{pct1(stats.humanPassedRate)}</span>
            </div>
          </div>
          <p className="field-hint">
            Medido, não estimado — só conta runs que chegaram no Relatório desde que essa
            instrumentação entrou no ar.
          </p>
        </>
      )}
    </div>
  );
}
