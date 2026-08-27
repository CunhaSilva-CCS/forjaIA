import { useEffect } from 'react';
import { api } from '../services/api';
import type { AppState } from '../hooks/useForjaApp';

export function FolderBrowserModal({ s }: { s: AppState }) {
  const { showFolderBrowser, setShowFolderBrowser } = s;

  useEffect(() => {
    if (!showFolderBrowser) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFolderBrowser(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showFolderBrowser, setShowFolderBrowser]);

  if (!showFolderBrowser) return null;
  return (
    <div className="modal-overlay" onClick={() => s.setShowFolderBrowser(false)}>
      <div
        className="forge-panel modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-browser-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="folder-browser-title">Navegador do workspace</h3>
        <p className="muted">Pastas relativas a:</p>
        <p style={{ fontSize: 12, wordBreak: 'break-all' }}>
          <code>{s.workspaceRoot || '…'}</code>
        </p>
        <p style={{ marginTop: 8 }}>
          Selecionado: <code>{s.currentBrowserPath}</code>
          {!s.browserExists && <span style={{ color: 'var(--warning)', marginLeft: 8 }}>(ainda não existe)</span>}
        </p>
        {s.browserListingPath !== s.currentBrowserPath && (
          <p className="muted">Listando conteúdo de: {s.browserListingPath}</p>
        )}
        {s.browserError && <p style={{ color: 'var(--error)' }}>{s.browserError}</p>}

        <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={!s.parentBrowserPath || s.browserLoading}
            aria-label="Voltar para a pasta anterior"
            onClick={() => s.browseTo(s.parentBrowserPath || '.')}
          >
            ..
          </button>
          <button
            className="btn-primary"
            disabled={s.browserLoading}
            onClick={() => {
              s.setTargetPath(s.currentBrowserPath);
              s.setShowFolderBrowser(false);
            }}
          >
            Usar esta pasta
          </button>
          {!s.browserExists && (
            <button
              disabled={s.browserLoading}
              onClick={async () => {
                try {
                  await api.mkdir(s.currentBrowserPath);
                  await s.browseTo(s.currentBrowserPath);
                } catch (err) {
                  s.showToast(err instanceof Error ? err.message : 'Falha ao criar');
                }
              }}
            >
              Criar caminho selecionado
            </button>
          )}
          <button onClick={() => s.setShowFolderBrowser(false)}>Fechar</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            placeholder="Nova pasta (ex: deployed)"
            aria-label="Nome da nova pasta"
            value={s.newFolderName}
            onChange={(e) => s.setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void s.createBrowserFolder();
            }}
            style={{ flex: 1 }}
          />
          <button disabled={s.browserLoading || !s.newFolderName.trim()} onClick={() => void s.createBrowserFolder()}>
            Criar
          </button>
        </div>

        <div className="file-list">
          {s.browserLoading && <p className="muted">Carregando…</p>}
          {!s.browserLoading && s.browserDirs.length === 0 && (
            <p className="muted">Nenhuma subpasta aqui. Crie uma acima ou use esta pasta.</p>
          )}
          {s.browserDirs.map((d) => (
            <button key={d.path} onClick={() => void s.browseTo(d.path)} disabled={s.browserLoading}>
              {d.name}/
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
