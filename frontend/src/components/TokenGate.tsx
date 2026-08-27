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
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token de acesso"
          style={{ width: '100%', marginBottom: 12 }}
        />
        {error && <p style={{ color: 'var(--danger)', marginBottom: 12, fontSize: 13 }}>{error}</p>}
        <button className="btn-primary" disabled={!token.trim() || loading} onClick={submit} style={{ width: '100%' }}>
          {loading ? 'Validando…' : 'Entrar'}
        </button>
      </div>
    </div>
  );
}
