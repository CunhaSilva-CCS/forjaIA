import type { AppState } from '../../hooks/useForjaApp';

export function SecurityTab({ s }: { s: AppState }) {
  return (
    <div className="cards-stack">
      {s.securityIssues.length === 0 && <p className="muted">Nenhum problema ainda.</p>}
      {s.securityIssues.map((issue) => (
        <div key={issue.id} className="issue-card">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{issue.title}</strong>
            <span className={`sev ${issue.severity?.toLowerCase()}`}>{issue.severity}</span>
          </div>
          <p>{issue.description}</p>
          <p className="muted">{issue.remediation}</p>
        </div>
      ))}
    </div>
  );
}
