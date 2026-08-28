import { useState } from 'react';
import { Flame } from 'lucide-react';
import { setStoredToken, getStoredToken } from '../config';
import { api } from '../services/api';

export function TokenGate({ onReady }: { onReady: (token: string) => void }) {
  const [token, setToken] = useState(getStoredToken());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setStoredToken(token.trim());
    try {
      await api.preferences.get();
      onReady(token.trim());
    } catch (err) {
      // Achado real: o token era persistido acima incondicionalmente, ANTES de validar. Um
      // token rejeitado ficava salvo mesmo assim — no próximo reload, App.tsx só checa
      // Boolean(getStoredToken()) e pula direto pro Dashboard com um token que o backend nunca
      // aceita, sem caminho de volta pra esta tela a não ser limpar o localStorage manualmente.
      setStoredToken('');
      setError(err instanceof Error ? err.message : 'Token inválido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="forge-panel" style={{ width: 'min(420px, 92vw)', padding: 28 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <div className="brand-mark">
            <Flame size={22} />
          </div>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>ForjaIA</h1>
            <p className="muted">Plano de controle self-hosted</p>
          </div>
        </div>
        <p style={{ marginBottom: 12, color: 'var(--ink-soft)', fontSize: 14 }}>
          Informe o <code>FORJA_API_TOKEN</code> do servidor (veja o terminal do backend ou o arquivo .env).
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="api-token" className="sr-only">
            Token de acesso
          </label>
          <input
            id="api-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Token de acesso"
            style={{ width: '100%', marginBottom: 12 }}
          />
          {error && (
            <p role="alert" style={{ color: 'var(--danger)', marginBottom: 12, fontSize: 13 }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={!token.trim() || loading}
            style={{ width: '100%' }}
          >
            {loading ? 'Validando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
