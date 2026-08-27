import type { AppState } from '../../hooks/useForjaApp';

export function AdrsTab({ s }: { s: AppState }) {
  return (
    <div className="cards-stack">
      {s.taskStatus === 'awaiting_approval' && (
        <p className="muted">Edite os ADRs antes de aprovar a arquitetura.</p>
      )}
      {s.adrs.map((adr, idx) => (
        <div key={adr.id} className="issue-card">
          <label htmlFor={`adr-title-${adr.id}`} className="sr-only">
            Título do ADR {adr.id}
          </label>
          <input
            id={`adr-title-${adr.id}`}
            value={adr.title}
            disabled={s.taskStatus !== 'awaiting_approval'}
            onChange={(e) => {
              const next = [...s.adrs];
              next[idx] = { ...adr, title: e.target.value };
              s.setAdrs(next);
            }}
            style={{ width: '100%', fontWeight: 600, marginBottom: 8 }}
          />
          <label htmlFor={`adr-decision-${adr.id}`} className="muted">
            Decisão
          </label>
          <textarea
            id={`adr-decision-${adr.id}`}
            value={adr.decision}
            disabled={s.taskStatus !== 'awaiting_approval'}
            onChange={(e) => {
              const next = [...s.adrs];
              next[idx] = { ...adr, decision: e.target.value };
              s.setAdrs(next);
            }}
            rows={3}
            style={{ width: '100%' }}
          />
          <label htmlFor={`adr-consequences-${adr.id}`} className="muted">
            Consequências
          </label>
          <textarea
            id={`adr-consequences-${adr.id}`}
            value={adr.consequences}
            disabled={s.taskStatus !== 'awaiting_approval'}
            onChange={(e) => {
              const next = [...s.adrs];
              next[idx] = { ...adr, consequences: e.target.value };
              s.setAdrs(next);
            }}
            rows={2}
            style={{ width: '100%' }}
          />
        </div>
      ))}
      {s.adrs.length === 0 && <p className="muted">Nenhum ADR ainda.</p>}
    </div>
  );
}
