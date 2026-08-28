import { CheckCircle, XCircle } from 'lucide-react';
import { api } from '../services/api';
import type { AppState } from '../hooks/useForjaApp';

export function TestsCard({ s }: { s: AppState }) {
  const passedCount = s.tests.filter((t) => t.passed).length;

  return (
    <div className="forge-panel side-block">
      <div className="panel-head-row">
        <h3>
          Testes
          {s.tests.length > 0 && (
            <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
              {passedCount}/{s.tests.length}
            </span>
          )}
        </h3>
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
      <div className="tests-list">
        {s.tests.map((t, i) => (
          <div key={i}>
            <div className={`test-row ${t.passed ? 'passed' : 'failed'}`}>
              <span className="test-status-icon">
                {t.passed ? <CheckCircle size={13} /> : <XCircle size={13} />}
              </span>
              <span className="test-name">{t.name}</span>
            </div>
            {!t.passed && t.error && <p className="test-error">{t.error}</p>}
          </div>
        ))}
      </div>
      {s.tests.length === 0 && <p className="muted">Sem testes ainda.</p>}
    </div>
  );
}
