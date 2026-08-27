import { Copy, ExternalLink, Link2 } from 'lucide-react';
import type { AppState } from '../hooks/useForjaApp';

export function DeployCard({ s }: { s: AppState }) {
  return (
    <div className={`forge-panel side-block deploy-card ${s.deployUrl ? 'is-live' : 'is-idle'}`}>
      <div className="deploy-card-head">
        <h3>
          <Link2 size={16} /> Deploy
        </h3>
        <span className={`deploy-pill ${s.deployUrl ? 'live' : 'idle'}`}>
          {s.taskStatus === 'completed' ? 'produção' : s.deployUrl ? 'ao vivo' : '—'}
        </span>
      </div>

      {s.deployUrl ? (
        <>
          <a className="deploy-url" href={s.deployUrl} target="_blank" rel="noreferrer" title={s.deployUrl}>
            {s.deployUrl.replace(/^https?:\/\//, '')}
          </a>
          <div className="deploy-actions">
            <a className="deploy-btn primary" href={s.deployUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Abrir
            </a>
            <button
              type="button"
              className="deploy-btn"
              aria-label="Copiar URL de deploy"
              title="Copiar URL"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(s.deployUrl!);
                  s.showToast('URL copiada');
                } catch {
                  s.showToast('Não foi possível copiar');
                }
              }}
            >
              <Copy size={14} />
            </button>
          </div>
        </>
      ) : (
        <p className="deploy-idle-copy muted">Aparece após o deploy.</p>
      )}
    </div>
  );
}
