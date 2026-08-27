import { api } from '../../services/api';
import { lineDiff } from '../../utils/diff';
import type { AppState } from '../../hooks/useForjaApp';

export function CodeTab({ s }: { s: AppState }) {
  const selectedFile = s.files.find((f) => f.path === s.selectedFilePath);
  const prevContent = s.fileVersions.length >= 2 ? s.fileVersions[s.fileVersions.length - 2].content : '';
  const currContent =
    s.fileVersions.length >= 1 ? s.fileVersions[s.fileVersions.length - 1].content : selectedFile?.content || '';
  const diffRows = s.showDiff ? lineDiff(prevContent, currContent) : [];

  return (
    <div className="code-explorer">
      <div className="file-list">
        {s.files.map((f) => (
          <button
            key={f.path}
            className={s.selectedFilePath === f.path ? 'active' : ''}
            onClick={() => {
              s.setSelectedFilePath(f.path);
              s.setShowDiff(false);
            }}
          >
            {f.path}
          </button>
        ))}
      </div>
      <div className="file-content">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={s.loadDiff} disabled={!s.currentRunId || !s.selectedFilePath}>
            Diff das versões
          </button>
          {s.showDiff && <button onClick={() => s.setShowDiff(false)}>Ver arquivo</button>}
          {s.currentRunId && (
            <>
              <button
                className="btn-link"
                onClick={() =>
                  api.runs
                    .downloadExport(s.currentRunId!)
                    .catch((e) => s.showToast(e instanceof Error ? e.message : 'Falha ao exportar'))
                }
              >
                Exportar ZIP
              </button>
              <button
                className="btn-link"
                onClick={() =>
                  api.runs
                    .downloadReportPdf(s.currentRunId!)
                    .catch((e) => s.showToast(e instanceof Error ? e.message : 'Falha ao gerar PDF'))
                }
              >
                Relatório PDF
              </button>
            </>
          )}
        </div>
        {s.showDiff ? (
          <pre className="diff-view">
            {diffRows.map((row, i) => (
              <div key={i} className={`diff-${row.type}`}>
                {row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : '  '}
                {row.text}
              </div>
            ))}
          </pre>
        ) : (
          <pre>
            <code>{selectedFile?.content || '// selecione um arquivo'}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
