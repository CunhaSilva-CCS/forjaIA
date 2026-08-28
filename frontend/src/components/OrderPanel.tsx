import { Check, FilePlus2, Play, Square } from 'lucide-react';
import { Dropdown } from './Dropdown';
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
        <Dropdown
          id="project-select"
          value={s.selectedProjectId || ''}
          disabled={s.isExecuting}
          ariaLabel="Projeto"
          placeholder="— escolher pasta do workspace —"
          emptyMessage="Nenhuma pasta no workspace."
          onChange={(v) => {
            void s.selectProject(v || null);
          }}
          options={[
            { value: '', label: '— escolher pasta do workspace —' },
            ...s.projects.map((p) => ({
              value: p.id,
              label: `${p.name}${p.source === 'workspace' ? ' · workspace' : ''}${!p.existsOnDisk ? ' · pasta ausente' : ''}`
            }))
          ]}
        />
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
        <Dropdown
          id="environment"
          value={s.environment}
          disabled={s.isExecuting}
          ariaLabel="Ambiente"
          onChange={(v) => s.setEnvironment(v as 'local' | 'staging')}
          options={[
            { value: 'local', label: 'local (:5100)' },
            { value: 'staging', label: 'staging (:5200)' }
          ]}
        />
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
