import type { AppState } from '../../hooks/useForjaApp';

export function TerminalTab({ s }: { s: AppState }) {
  return (
    <div className="terminal">
      {s.logs.map((log, i) => (
        <div key={i} className={`log-line ${log.type}`}>
          <span className="log-agent">[{log.agent}]</span> {log.message}
        </div>
      ))}
      <div ref={s.logsEndRef} />
    </div>
  );
}
