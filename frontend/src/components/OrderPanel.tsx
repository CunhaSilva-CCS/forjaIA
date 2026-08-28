import { Check, FilePlus2, Play, Square } from 'lucide-react';
import type { AppState } from '../hooks/useForjaApp';

export function OrderPanel({ s }: { s: AppState }) {
  return (
    <div className="forge-panel prompt-panel">
      <div className="panel-head-row">
        <h3 className="panel-title" style={{ marginBottom: 0 }}>
          Ordem
        </h3>
        <button
          type="button"
          className="btn-tiny"
          onClick={s.resetWorkspace}
          disabled={s.isExecuting}
          title="Limpar a tela e começar outro projeto (ou escolher um projeto existente abaixo)"
        >
          <FilePlus2 size={12} /> Novo
        </button>
      </div>
      <textarea
        value={s.prompt}
        onChange={(e) => s.setPrompt(e.target.value)}
        disabled={s.isExecuting}
        rows={3}
        placeholder="Descreva o software a forjar…"
        aria-label="Ordem: descreva o software a forjar"
      />

      <div className="field">
        <label htmlFor="project-select">Projeto</label>
        <select
          id="project-select"
          value={s.selectedProjectId || ''}
          disabled={s.isExecuting}
          onChange={(e) => {
            void s.selectProject(e.target.value || null);
          }}
        >
          <option value="">— escolher pasta do workspace —</option>
          {s.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.source === 'workspace' ? ' · workspace' : ''}
              {!p.existsOnDisk ? ' · pasta ausente' : ''}
            </option>
          ))}
        </select>
        {s.projects.length === 0 ? (
          <div className="empty-projects">Nenhuma pasta no workspace.</div>
        ) : (
          <p className="field-hint">{s.projects.length} projeto(s)</p>
        )}
      </div>

      <div className="field">
        <label htmlFor="target-path">Destino</label>
        <div className="field-row">
          <input
            id="target-path"
            value={s.targetPath}
            onChange={(e) => s.setTargetPath(e.target.value)}
            disabled={s.isExecuting}
            placeholder="ex: rag-profissional"
          />
          <button type="button" onClick={s.openFolderBrowser} disabled={s.isExecuting}>
            Navegar
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="environment">Ambiente</label>
        <select
          id="environment"
          value={s.environment}
          disabled={s.isExecuting}
          onChange={(e) => s.setEnvironment(e.target.value as 'local' | 'staging')}
        >
          <option value="local">local (:5100)</option>
          <option value="staging">staging (:5200)</option>
        </select>
      </div>

      <div className="actions-row">
        {s.taskStatus === 'awaiting_approval' ? (
          <button className="btn-primary" onClick={s.handleApprove} disabled={s.isExecuting} style={{ flex: 1 }}>
            <Check size={16} /> {s.approveButtonLabel}
          </button>
        ) : (
          <>
            <button
              className="btn-primary"
              onClick={s.handleRun}
              disabled={s.isExecuting || !s.prompt.trim()}
              style={{ flex: 1 }}
              title="Criar do zero: Arquiteto → Codificador → qualidade"
            >
              <Play size={16} /> Forjar
            </button>
            <button
              onClick={s.handleValidateExisting}
              disabled={s.isExecuting || !s.targetPath?.trim()}
              title="Projeto pronto: Qualidade → Segurança → … → Humano → Reporter"
            >
              Validar pronto
            </button>
          </>
        )}
        {(s.isExecuting || s.taskStatus === 'awaiting_approval') && (
          <button type="button" onClick={s.handleCancel} title="Cancelar" aria-label="Cancelar execução">
            <Square size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
