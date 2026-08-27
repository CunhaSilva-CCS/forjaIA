import type { AppState } from '../../hooks/useForjaApp';

export function TeamTab({ s }: { s: AppState }) {
  return (
    <div className="cards-stack">
      <div className="issue-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <strong>Célula de produção</strong>
          <button type="button" onClick={() => void s.refreshTeamBoard()}>
            Atualizar
          </button>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          Você: {s.teamMe ? `${s.teamMe.name} (${s.teamMe.role})` : '—'}
          {s.serviceStatus ? ` · API ${s.serviceStatus.online ? 'online' : 'off'} :${s.serviceStatus.port}` : ''}
        </p>
        {(s.teamInfo?.members || []).map((m) => (
          <div key={m.id} className="log-line" style={{ marginTop: 4 }}>
            <strong>{m.name}</strong> · {m.role}
            {m.tokenHint ? <span className="muted"> · {m.tokenHint}</span> : null}
          </div>
        ))}
        {s.teamInfo?.bootstrapTokens && (
          <p className="muted" style={{ marginTop: 8, fontSize: 11 }}>
            Tokens bootstrap (local): lead / qa / sre — veja API `/api/team` ou logs do seed.
            {s.teamInfo.bootstrapTokens.note ? ` ${s.teamInfo.bootstrapTokens.note}` : ''}
          </p>
        )}
      </div>

      <div className="issue-card">
        <strong>Fila ({s.teamBoard.queued?.length || 0})</strong>
        {(s.teamBoard.queued || []).length === 0 && <p className="muted">Vazia</p>}
        {(s.teamBoard.queued || []).map((r) => (
          <div key={r.id} className="log-line">
            #{r.queue_position || '—'} {r.owner_name || '—'} · {String(r.prompt || '').slice(0, 80)}
          </div>
        ))}
      </div>

      <div className="issue-card">
        <strong>Aguardando aprovação ({s.teamBoard.awaiting?.length || 0})</strong>
        {(s.teamBoard.awaiting || []).length === 0 && <p className="muted">Nenhum gate aberto</p>}
        {(s.teamBoard.awaiting || []).map((r) => (
          <div key={r.id} className="log-line">
            {r.owner_name || '—'} · {r.config?.pendingNextStage || '—'} · {String(r.prompt || '').slice(0, 60)}
          </div>
        ))}
      </div>

      <div className="issue-card">
        <strong>Papéis × etapas</strong>
        {s.teamInfo?.stageRoles &&
          Object.entries(s.teamInfo.stageRoles).map(([stage, roles]) => (
            <div key={stage} className="log-line muted" style={{ fontSize: 12 }}>
              {stage}: {roles.join(', ')}
            </div>
          ))}
      </div>
    </div>
  );
}
