import { useState } from 'react';
import type { AppState } from '../../hooks/useForjaApp';
import type { AuditRun } from '../../types/agent';
import { formatDate } from '../../utils/format';

const STATUS_LABEL: Record<AuditRun['status'], string> = {
  running: 'Rodando…',
  completed: 'Concluída',
  failed: 'Falhou'
};

function severityOf(findings: AuditRun['findings']) {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    const sev = String(f.severity || '').toUpperCase();
    counts[sev] = (counts[sev] || 0) + 1;
  }
  return counts;
}

function AuditRunCard({ run }: { run: AuditRun }) {
  const [open, setOpen] = useState(false);
  const counts = severityOf(run.findings);
  const skipped = Object.entries(run.tools || {})
    .filter(([, t]) => t.available === false)
    .map(([name, t]) => `${name}: ${t.skippedReason || 'indisponível'}`);

  return (
    <div className="issue-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <strong>{run.target === 'self' ? 'ForjaIA (self)' : `Projeto: ${run.targetPath}`}</strong>
          <p className="muted">{formatDate(run.startedAt)}</p>
        </div>
        <span className="status-badge">{STATUS_LABEL[run.status]}</span>
      </div>

      {run.status === 'completed' && (
        <>
          <p style={{ marginTop: 8 }}>{run.summary || 'nenhum achado'}</p>
          {run.findings.length > 0 && (
            <button className="btn-link" onClick={() => setOpen((v) => !v)}>
              {open ? 'ocultar achados' : `ver ${run.findings.length} achado(s)`}
            </button>
          )}
          {open && (
            <div className="cards-stack" style={{ marginTop: 8 }}>
              {run.findings.map((f) => (
                <div key={`${f.id}-${f.file}-${f.line ?? ''}`} className="issue-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{f.title}</strong>
                    <span className={`sev ${f.severity?.toLowerCase()}`}>{f.severity}</span>
                  </div>
                  <p className="muted">
                    {f.file}
                    {f.line ? `:${f.line}` : ''}
                  </p>
                  {f.description && <p>{f.description}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {run.status === 'failed' && <p className="muted">{run.error}</p>}

      {skipped.length > 0 && (
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          {skipped.join(' · ')}
        </p>
      )}

      {Object.keys(counts).length > 0 && (
        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          {Object.entries(counts)
            .map(([sev, n]) => `${n} ${sev}`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

function DogfoodStatusCard({ s }: { s: AppState }) {
  const status = s.dogfoodStatus;
  const lastRun = status?.lastRun;
  return (
    <div className="issue-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Dogfooding automático</strong>
        <span className="status-badge">{status?.scheduled ? 'Agendado (semanal)' : 'Não agendado'}</span>
      </div>
      <p className="muted">
        Toda segunda às 6h, roda uma forja real de ponta a ponta contra o próprio ForjaIA e aprova os gates
        sozinho — mesma ideia da sessão de dogfooding ao vivo que achou o bug do ADR-034, agora sem precisar de
        alguém acompanhando a tela. Ver ADR-035.
      </p>
      {!status?.scheduled && (
        <p className="muted">
          Nenhuma entrada de crontab com o dogfooding foi encontrada. Reinstale com{' '}
          <code>crontab</code> (ver <code>docs/adr/035-scheduled-dogfooding.md</code>).
        </p>
      )}
      {lastRun ? (
        <p style={{ marginTop: 4 }}>
          Última run: <strong>{lastRun.outcome}</strong> em {formatDate(lastRun.finishedAt)} —{' '}
          {lastRun.testsPassed ?? '?'}/{lastRun.testsTotal ?? '?'} testes
        </p>
      ) : (
        status?.scheduled && <p className="muted">Ainda sem nenhuma run registrada.</p>
      )}
      <button className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={() => void s.refreshDogfoodStatus()}>
        atualizar
      </button>
    </div>
  );
}

export function AuditTab({ s }: { s: AppState }) {
  return (
    <div className="cards-stack">
      <DogfoodStatusCard s={s} />
      <div className="issue-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p className="muted">
          Semgrep (padrão determinístico) + npm audit (dependência vulnerável conhecida) — separado do pipeline de
          forja, roda quando você pedir.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button disabled={s.auditTriggering} onClick={() => s.triggerAudit('self')}>
            {s.auditTriggering ? 'Disparando…' : 'Auditar o ForjaIA'}
          </button>
          <button
            disabled={s.auditTriggering || !s.targetPath || s.targetPath === 'deployed'}
            onClick={() => s.triggerAudit('project', s.targetPath)}
            title={
              !s.targetPath || s.targetPath === 'deployed'
                ? 'Selecione um projeto (campo Destino) para auditar'
                : undefined
            }
          >
            Auditar projeto atual
          </button>
        </div>
      </div>

      {s.auditLoading && s.auditRuns.length === 0 && <p className="muted">Carregando…</p>}
      {!s.auditLoading && s.auditRuns.length === 0 && <p className="muted">Nenhuma auditoria rodada ainda.</p>}
      {s.auditRuns.map((run) => (
        <AuditRunCard key={run.id} run={run} />
      ))}
    </div>
  );
}
