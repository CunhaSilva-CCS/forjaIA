import type { AppState } from '../../hooks/useForjaApp';
import type { ApiContract, DataModel, NonFunctionalRequirement, PlanDependency, TestScenario } from '../../types/agent';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const EXPECT_OPTIONS = ['none', 'list', 'object-id', 'token'] as const;

function canEditPlan(s: AppState): boolean {
  return s.taskStatus === 'awaiting_approval' && s.pendingNextStage === 'coder';
}

function jsonField(value: unknown): string {
  if (value == null || value === '') return '';
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonField(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed) as unknown;
}

export function ArchitectureTab({ s }: { s: AppState }) {
  const editable = canEditPlan(s);

  return (
    <div className="cards-stack">
      {editable && (
        <p className="muted">
          Revise contratos, cenários de teste (o QA executa literalmente), dependências e NFRs antes de aprovar a
          codificação.
        </p>
      )}

      {s.architectSeniorReview?.summary && (
        <div className="issue-card">
          <strong>Revisão arquitetural sênior</strong>
          {s.architectSeniorReview.verdict && (
            <p className="muted" style={{ margin: '6px 0' }}>
              Veredito: {s.architectSeniorReview.verdict}
            </p>
          )}
          <p style={{ margin: '6px 0' }}>{s.architectSeniorReview.summary}</p>
          {s.architectSeniorReview.risks?.length ? (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {s.architectSeniorReview.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <section>
        <div className="panel-head-row">
          <h4 style={{ margin: 0 }}>Cenários de teste (QA)</h4>
          {editable && (
            <button
              type="button"
              className="btn-tiny"
              onClick={() =>
                s.setTestScenarios([
                  ...s.testScenarios,
                  {
                    name: 'Novo cenário',
                    method: 'GET',
                    path: '/health',
                    expectedStatus: '200',
                    expect: 'none',
                    auth: false
                  }
                ])
              }
            >
              + cenário
            </button>
          )}
        </div>
        {s.testScenarios.map((scenario, idx) => (
          <TestScenarioCard
            key={`${scenario.method}-${scenario.path}-${idx}`}
            scenario={scenario}
            editable={editable}
            onChange={(next) => {
              const copy = [...s.testScenarios];
              copy[idx] = next;
              s.setTestScenarios(copy);
            }}
            onRemove={
              editable
                ? () => s.setTestScenarios(s.testScenarios.filter((_, i) => i !== idx))
                : undefined
            }
          />
        ))}
        {s.testScenarios.length === 0 && (
          <p className="muted">Nenhum cenário — o backend derivará casos mínimos dos contratos de API.</p>
        )}
      </section>

      <section>
        <div className="panel-head-row">
          <h4 style={{ margin: 0 }}>Contratos de API</h4>
          {editable && (
            <button
              type="button"
              className="btn-tiny"
              onClick={() =>
                s.setApiContracts([
                  ...s.apiContracts,
                  { method: 'GET', path: '/api/...', description: '', auth: false }
                ])
              }
            >
              + contrato
            </button>
          )}
        </div>
        {s.apiContracts.map((contract, idx) => (
          <ApiContractCard
            key={`${contract.method}-${contract.path}-${idx}`}
            contract={contract}
            editable={editable}
            onChange={(next) => {
              const copy = [...s.apiContracts];
              copy[idx] = next;
              s.setApiContracts(copy);
            }}
            onRemove={
              editable
                ? () => s.setApiContracts(s.apiContracts.filter((_, i) => i !== idx))
                : undefined
            }
          />
        ))}
        {s.apiContracts.length === 0 && <p className="muted">Nenhum contrato de API.</p>}
      </section>

      <section>
        <div className="panel-head-row">
          <h4 style={{ margin: 0 }}>Modelos de dados</h4>
          {editable && (
            <button
              type="button"
              className="btn-tiny"
              onClick={() =>
                s.setDataModels([
                  ...s.dataModels,
                  { name: 'Entity', description: '', fields: [{ name: 'id', type: 'string', required: true }] }
                ])
              }
            >
              + modelo
            </button>
          )}
        </div>
        {s.dataModels.map((model, idx) => (
          <DataModelCard
            key={`${model.name}-${idx}`}
            model={model}
            editable={editable}
            onChange={(next) => {
              const copy = [...s.dataModels];
              copy[idx] = next;
              s.setDataModels(copy);
            }}
            onRemove={
              editable
                ? () => s.setDataModels(s.dataModels.filter((_, i) => i !== idx))
                : undefined
            }
          />
        ))}
        {s.dataModels.length === 0 && <p className="muted">Nenhum modelo de dados.</p>}
      </section>

      <section>
        <div className="panel-head-row">
          <h4 style={{ margin: 0 }}>Dependências</h4>
          {editable && (
            <button
              type="button"
              className="btn-tiny"
              onClick={() => s.setPlanDependencies([...s.planDependencies, { name: 'express', reason: '' }])}
            >
              + dependência
            </button>
          )}
        </div>
        {s.planDependencies.map((dep, idx) => (
          <div key={`${dep.name}-${idx}`} className="issue-card">
            <label className="sr-only" htmlFor={`dep-name-${idx}`}>
              Nome da dependência
            </label>
            <input
              id={`dep-name-${idx}`}
              value={dep.name}
              disabled={!editable}
              placeholder="pacote npm"
              onChange={(e) => {
                const copy = [...s.planDependencies];
                copy[idx] = { ...dep, name: e.target.value };
                s.setPlanDependencies(copy);
              }}
              style={{ width: '100%', marginBottom: 6 }}
            />
            <label className="muted" htmlFor={`dep-version-${idx}`}>
              Versão
            </label>
            <input
              id={`dep-version-${idx}`}
              value={dep.version || ''}
              disabled={!editable}
              placeholder="^1.0.0"
              onChange={(e) => {
                const copy = [...s.planDependencies];
                copy[idx] = { ...dep, version: e.target.value };
                s.setPlanDependencies(copy);
              }}
              style={{ width: '100%', marginBottom: 6 }}
            />
            <label className="muted" htmlFor={`dep-reason-${idx}`}>
              Motivo
            </label>
            <input
              id={`dep-reason-${idx}`}
              value={dep.reason || ''}
              disabled={!editable}
              onChange={(e) => {
                const copy = [...s.planDependencies];
                copy[idx] = { ...dep, reason: e.target.value };
                s.setPlanDependencies(copy);
              }}
              style={{ width: '100%' }}
            />
            {editable && (
              <button type="button" className="btn-tiny" style={{ marginTop: 8 }} onClick={() => s.setPlanDependencies(s.planDependencies.filter((_, i) => i !== idx))}>
                Remover
              </button>
            )}
          </div>
        ))}
        {s.planDependencies.length === 0 && <p className="muted">Nenhuma dependência listada.</p>}
      </section>

      <section>
        <div className="panel-head-row">
          <h4 style={{ margin: 0 }}>Requisitos não-funcionais</h4>
          {editable && (
            <button
              type="button"
              className="btn-tiny"
              onClick={() =>
                s.setNonFunctional([
                  ...s.nonFunctional,
                  { area: 'segurança', requirement: '' }
                ])
              }
            >
              + NFR
            </button>
          )}
        </div>
        {s.nonFunctional.map((nfr, idx) => (
          <NonFunctionalCard
            key={`${nfr.area}-${idx}`}
            nfr={nfr}
            editable={editable}
            onChange={(next) => {
              const copy = [...s.nonFunctional];
              copy[idx] = next;
              s.setNonFunctional(copy);
            }}
            onRemove={
              editable ? () => s.setNonFunctional(s.nonFunctional.filter((_, i) => i !== idx)) : undefined
            }
          />
        ))}
        {s.nonFunctional.length === 0 && <p className="muted">Nenhum NFR documentado.</p>}
      </section>
    </div>
  );
}

function TestScenarioCard({
  scenario,
  editable,
  onChange,
  onRemove
}: {
  scenario: TestScenario;
  editable: boolean;
  onChange: (next: TestScenario) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="issue-card">
      <input
        value={scenario.name}
        disabled={!editable}
        placeholder="Nome do cenário"
        onChange={(e) => onChange({ ...scenario, name: e.target.value })}
        style={{ width: '100%', fontWeight: 600, marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <select
          value={scenario.method}
          disabled={!editable}
          onChange={(e) => onChange({ ...scenario, method: e.target.value })}
          aria-label="Método HTTP do cenário"
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          value={scenario.path}
          disabled={!editable}
          placeholder="/api/rota"
          onChange={(e) => onChange({ ...scenario, path: e.target.value })}
          style={{ flex: 1, minWidth: 160 }}
        />
        <input
          value={scenario.expectedStatus || '2xx'}
          disabled={!editable}
          placeholder="expectedStatus"
          onChange={(e) => onChange({ ...scenario, expectedStatus: e.target.value })}
          style={{ width: 72 }}
        />
        <select
          value={scenario.expect || 'none'}
          disabled={!editable}
          onChange={(e) => onChange({ ...scenario, expect: e.target.value })}
          aria-label="Expectativa do corpo"
        >
          {EXPECT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={Boolean(scenario.auth)}
            disabled={!editable}
            onChange={(e) => onChange({ ...scenario, auth: e.target.checked })}
          />
          auth
        </label>
      </div>
      <label className="muted">Body (JSON, opcional)</label>
      <textarea
        defaultValue={jsonField(scenario.body)}
        disabled={!editable}
        rows={2}
        style={{ width: '100%', marginBottom: 8 }}
        onBlur={(e) => {
          if (!editable) return;
          try {
            onChange({ ...scenario, body: parseJsonField(e.target.value) });
          } catch {
            // mantém anterior
          }
        }}
      />
      <input
        value={scenario.captureAs || ''}
        disabled={!editable}
        placeholder="captureAs (opcional)"
        onChange={(e) => onChange({ ...scenario, captureAs: e.target.value || undefined })}
        style={{ width: '100%' }}
      />
      {onRemove && (
        <button type="button" className="btn-tiny" style={{ marginTop: 8 }} onClick={onRemove}>
          Remover
        </button>
      )}
    </div>
  );
}

function ApiContractCard({
  contract,
  editable,
  onChange,
  onRemove
}: {
  contract: ApiContract;
  editable: boolean;
  onChange: (next: ApiContract) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="issue-card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select
          value={contract.method}
          disabled={!editable}
          onChange={(e) => onChange({ ...contract, method: e.target.value })}
          aria-label="Método HTTP"
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          value={contract.path}
          disabled={!editable}
          placeholder="/api/rota"
          onChange={(e) => onChange({ ...contract, path: e.target.value })}
          style={{ flex: 1 }}
          aria-label="Path da rota"
        />
      </div>
      <input
        value={contract.description}
        disabled={!editable}
        placeholder="Descrição"
        onChange={(e) => onChange({ ...contract, description: e.target.value })}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <label className="muted" htmlFor={`auth-${contract.path}`}>
        Auth
      </label>
      <input
        id={`auth-${contract.path}`}
        value={contract.auth === false ? 'false' : String(contract.auth ?? '')}
        disabled={!editable}
        placeholder="false ou Bearer JWT"
        onChange={(e) => {
          const v = e.target.value.trim();
          onChange({
            ...contract,
            auth: v === 'false' ? false : v === 'true' ? true : v
          });
        }}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <label className="muted">Request (JSON)</label>
      <textarea
        defaultValue={jsonField(contract.request)}
        disabled={!editable}
        rows={3}
        style={{ width: '100%', marginBottom: 8 }}
        onBlur={(e) => {
          if (!editable) return;
          try {
            onChange({ ...contract, request: parseJsonField(e.target.value) });
          } catch {
            // JSON inválido — mantém valor anterior até correção
          }
        }}
      />
      <label className="muted">Response (JSON)</label>
      <textarea
        defaultValue={jsonField(contract.response)}
        disabled={!editable}
        rows={3}
        style={{ width: '100%' }}
        onBlur={(e) => {
          if (!editable) return;
          try {
            onChange({ ...contract, response: parseJsonField(e.target.value) });
          } catch {
            // JSON inválido — mantém valor anterior até correção
          }
        }}
      />
      {onRemove && (
        <button type="button" className="btn-tiny" style={{ marginTop: 8 }} onClick={onRemove}>
          Remover
        </button>
      )}
    </div>
  );
}

function DataModelCard({
  model,
  editable,
  onChange,
  onRemove
}: {
  model: DataModel;
  editable: boolean;
  onChange: (next: DataModel) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="issue-card">
      <input
        value={model.name}
        disabled={!editable}
        placeholder="Nome da entidade"
        onChange={(e) => onChange({ ...model, name: e.target.value })}
        style={{ width: '100%', fontWeight: 600, marginBottom: 8 }}
      />
      <input
        value={model.description || ''}
        disabled={!editable}
        placeholder="Descrição"
        onChange={(e) => onChange({ ...model, description: e.target.value })}
        style={{ width: '100%', marginBottom: 8 }}
      />
      {model.fields.map((field, fIdx) => (
        <div key={`${field.name}-${fIdx}`} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <input
            value={field.name}
            disabled={!editable}
            placeholder="campo"
            onChange={(e) => {
              const fields = [...model.fields];
              fields[fIdx] = { ...field, name: e.target.value };
              onChange({ ...model, fields });
            }}
          />
          <input
            value={field.type}
            disabled={!editable}
            placeholder="tipo"
            onChange={(e) => {
              const fields = [...model.fields];
              fields[fIdx] = { ...field, type: e.target.value };
              onChange({ ...model, fields });
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={Boolean(field.required)}
              disabled={!editable}
              onChange={(e) => {
                const fields = [...model.fields];
                fields[fIdx] = { ...field, required: e.target.checked };
                onChange({ ...model, fields });
              }}
            />
            obrigatório
          </label>
          {editable && (
            <button
              type="button"
              className="btn-tiny"
              onClick={() => onChange({ ...model, fields: model.fields.filter((_, i) => i !== fIdx) })}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {editable && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn-tiny"
            onClick={() =>
              onChange({
                ...model,
                fields: [...model.fields, { name: 'campo', type: 'string', required: false }]
              })
            }
          >
            + campo
          </button>
          {onRemove && (
            <button type="button" className="btn-tiny" onClick={onRemove}>
              Remover modelo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NonFunctionalCard({
  nfr,
  editable,
  onChange,
  onRemove
}: {
  nfr: NonFunctionalRequirement;
  editable: boolean;
  onChange: (next: NonFunctionalRequirement) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="issue-card">
      <input
        value={nfr.area}
        disabled={!editable}
        placeholder="área (segurança, observabilidade…)"
        onChange={(e) => onChange({ ...nfr, area: e.target.value })}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <textarea
        value={nfr.requirement}
        disabled={!editable}
        rows={2}
        placeholder="requisito"
        onChange={(e) => onChange({ ...nfr, requirement: e.target.value })}
        style={{ width: '100%' }}
      />
      {onRemove && (
        <button type="button" className="btn-tiny" style={{ marginTop: 8 }} onClick={onRemove}>
          Remover
        </button>
      )}
    </div>
  );
}
