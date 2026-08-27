import type { AppState } from '../../hooks/useForjaApp';

export function DiagnosisTab({ s }: { s: AppState }) {
  return (
    <div className="cards-stack">
      {!s.diagnosis && <p className="muted">Aguardando diagnóstico do Depurador Sênior…</p>}
      {s.diagnosis && (
        <>
          <div className="issue-card diagnosis-summary">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <strong>Resumo</strong>
              <span className={`sev ${s.diagnosis.severity?.toLowerCase()}`}>{s.diagnosis.severity}</span>
            </div>
            <p>{s.diagnosis.summary}</p>
            {s.diagnosis.notesForHealer && <p className="muted">Para o Curador: {s.diagnosis.notesForHealer}</p>}
          </div>
          {(s.diagnosis.rootCauses || []).map((rc) => (
            <div key={rc.id} className="issue-card">
              <strong>
                {rc.id}: {rc.title}
              </strong>
              <p className="muted">
                Confiança {(rc.confidence * 100).toFixed(0)}% · {rc.evidence}
              </p>
              {rc.affectedFiles?.length > 0 && <p className="muted">Arquivos: {rc.affectedFiles.join(', ')}</p>}
            </div>
          ))}
          {(s.diagnosis.recommendedFixes || []).map((fix, i) => (
            <div key={i} className="issue-card">
              <strong>
                Fix #{fix.priority}: {fix.action}
              </strong>
              {fix.files?.length > 0 && <p className="muted">{fix.files.join(', ')}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
