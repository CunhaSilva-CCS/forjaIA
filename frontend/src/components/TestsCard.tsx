import { AlertCircle, CheckCircle } from 'lucide-react';
import { api } from '../services/api';
import type { AppState } from '../hooks/useForjaApp';

export function TestsCard({ s }: { s: AppState }) {
  return (
    <div className="forge-panel side-block">
      <div className="panel-head-row">
        <h3>Testes</h3>
        {s.currentRunId && (
          <button
            className="btn-link"
            onClick={() =>
              api.runs
                .downloadReportPdf(s.currentRunId!)
                .catch((e) => s.showToast(e instanceof Error ? e.message : 'Falha ao gerar PDF'))
            }
          >
            PDF
          </button>
        )}
      </div>
      {s.tests.map((t, i) => (
        <div key={i} className="log-line compact">
          {t.passed ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {t.name}
        </div>
      ))}
      {s.tests.length === 0 && <p className="muted">Sem testes ainda.</p>}
    </div>
  );
}
