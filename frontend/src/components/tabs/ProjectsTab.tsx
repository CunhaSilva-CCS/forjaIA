import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import type { AppState } from '../../hooks/useForjaApp';

export function ProjectsTab({ s }: { s: AppState }) {
  return (
    <div>
      <div className="issue-card" style={{ marginBottom: 12 }}>
        <h4>Novo projeto</h4>
        <input
          placeholder="Nome"
          aria-label="Nome do projeto"
          value={s.newProjectName}
          onChange={(e) => s.setNewProjectName(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <input
          placeholder="Caminho relativo no workspace"
          aria-label="Caminho relativo no workspace"
          value={s.newProjectPath}
          onChange={(e) => s.setNewProjectPath(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <button className="btn-primary" onClick={s.createProject} disabled={!s.newProjectName.trim()}>
          <Plus size={14} /> Criar
        </button>
      </div>
      {s.projects.map((p) => (
        <div key={p.id} className="issue-card" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <strong>{p.name}</strong>
            <p className="muted">
              {p.path}
              {p.source === 'workspace' ? ' · pasta do workspace' : ' · registrado'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => void s.selectProject(p.id)}>Usar</button>
            {p.source === 'registered' && !String(p.id).startsWith('ws:') && (
              <button
                type="button"
                aria-label={`Remover projeto: ${p.name}`}
                title="Remover projeto"
                onClick={async () => {
                  await api.projects.remove(p.id);
                  s.refreshMeta();
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      ))}
      {s.projects.length === 0 && <p className="muted">Nenhum projeto. Crie acima ou adicione pastas em workspace/.</p>}
    </div>
  );
}
