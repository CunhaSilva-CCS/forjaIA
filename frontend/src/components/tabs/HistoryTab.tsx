import { api } from '../../services/api';
import type { AppState } from '../../hooks/useForjaApp';
import { formatDate } from '../../utils/format';

export function HistoryTab({ s }: { s: AppState }) {
  return (
    <div className="cards-stack">
      {s.runs.map((run) => (
        <div key={run.id} className="issue-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <strong>{run.status}</strong>
            <p style={{ fontSize: 13 }}>{run.prompt.slice(0, 120)}</p>
            <p className="muted">{formatDate(run.started_at)}</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button onClick={() => s.openRun(run.id)}>Abrir</button>
            <button
              className="btn-link"
              onClick={() =>
                api.runs.downloadExport(run.id).catch((e) => s.showToast(e instanceof Error ? e.message : 'Falha ao exportar'))
              }
            >
              Export
            </button>
            <button
              className="btn-link"
              onClick={() =>
                api.runs
                  .downloadReportPdf(run.id)
                  .catch((e) => s.showToast(e instanceof Error ? e.message : 'Falha ao gerar PDF'))
              }
            >
              PDF
            </button>
          </div>
        </div>
      ))}
      {s.runs.length === 0 && <p className="muted">Nenhuma execução ainda.</p>}
    </div>
  );
}
