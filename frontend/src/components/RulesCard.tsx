import { Plus, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import type { AppState } from '../hooks/useForjaApp';

export function RulesCard({ s }: { s: AppState }) {
  return (
    <div className="forge-panel side-block">
      <h3>Regras</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={s.newRule}
          onChange={(e) => s.setNewRule(e.target.value)}
          placeholder="Nova regra"
          aria-label="Nova regra"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          aria-label="Adicionar regra"
          title="Adicionar regra"
          onClick={() => {
            if (!s.newRule.trim()) return;
            const updated = [...s.styleRules, s.newRule.trim()];
            s.setNewRule('');
            s.saveRules(updated);
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      <button
        type="button"
        className="btn-ghost-full"
        onClick={async () => {
          try {
            const res = await api.preferences.resetSenior();
            s.setStyleRules(res.data?.styleRules || []);
            s.showToast(res.message || 'Regras elite restauradas');
          } catch (err) {
            s.showToast(err instanceof Error ? err.message : 'Falha ao restaurar regras');
          }
        }}
      >
        Restaurar elite
      </button>
      <ul className="rules-list">
        {s.styleRules.map((rule, i) => (
          <li key={i}>
            <span>{rule}</span>
            <button
              type="button"
              aria-label={`Remover regra: ${rule}`}
              title="Remover regra"
              onClick={() => s.saveRules(s.styleRules.filter((_, idx) => idx !== i))}
            >
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
      {s.styleRules.length === 0 && (
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Nenhuma regra — restaure as elite.
        </p>
      )}
    </div>
  );
}
