import { useState } from 'react';
import type { AppState } from '../../hooks/useForjaApp';

const ROLE_OPTIONS = ['member', 'lead', 'qa', 'sre', 'viewer', 'admin'];

function randomToken() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function NewMemberForm({ s }: { s: AppState }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [token, setToken] = useState(randomToken());
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !token.trim() || submitting) return;
    setSubmitting(true);
    try {
      await s.createTeamMember({ name: name.trim(), role, token: token.trim() });
      setName('');
      setToken(randomToken());
    } catch {
      // erro já reportado via toast em createTeamMember
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="issue-card" style={{ display: 'grid', gap: 8 }}>
      <strong>Novo membro</strong>
      <input
        type="text"
        placeholder="Nome"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={submitting}
      />
      <select value={role} onChange={(e) => setRole(e.target.value)} disabled={submitting}>
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={submitting}
          style={{ flex: 1, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
        />
        <button type="button" onClick={() => setToken(randomToken())} disabled={submitting}>
          Gerar
        </button>
      </div>
      <button type="submit" disabled={submitting || !name.trim() || !token.trim()}>
        {submitting ? 'Criando…' : 'Criar membro'}
      </button>
    </form>
  );
}

export function TeamTab({ s }: { s: AppState }) {
  const isAdmin = Boolean(s.teamMe?.isAdmin);

  return (
    <div className="cards-stack">
      <div className="issue-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <strong>Célula de produção</strong>
          <button
            type="button"
            onClick={() => {
              void s.refreshTeamBoard();
              void s.refreshTeamInfo();
            }}
          >
            Atualizar
          </button>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          Você: {s.teamMe ? `${s.teamMe.name} (${s.teamMe.role})` : '—'}
          {s.serviceStatus ? ` · API ${s.serviceStatus.online ? 'online' : 'off'} :${s.serviceStatus.port}` : ''}
        </p>
        {(s.teamInfo?.members || []).map((m) => (
          <div
            key={m.id}
            className="log-line"
            style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
          >
            <span>
              <strong>{m.name}</strong> · {m.role}
              {m.tokenHint ? <span className="muted"> · {m.tokenHint}</span> : null}
            </span>
            {isAdmin && (
              <button type="button" onClick={() => void s.deactivateTeamMember(m.id, m.name)} title="Desativar membro">
                Desativar
              </button>
            )}
          </div>
        ))}
        {s.teamInfo?.bootstrapTokens && (
          <p className="muted" style={{ marginTop: 8, fontSize: 11 }}>
            Tokens bootstrap (local): lead / qa / sre — veja API `/api/team` ou logs do seed.
            {s.teamInfo.bootstrapTokens.note ? ` ${s.teamInfo.bootstrapTokens.note}` : ''}
          </p>
        )}
      </div>

      {isAdmin && <NewMemberForm s={s} />}

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
