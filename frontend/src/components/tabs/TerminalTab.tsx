import { useState } from 'react';
import { Send } from 'lucide-react';
import type { AppState } from '../../hooks/useForjaApp';

// Mensagens de erro do backend costumam embutir o stack trace inteiro do
// processo filho (docker/ts-node) na mesma string da narração. Acima desse
// tamanho, a linha vira "resumo + alternar" em vez de despejar tudo na tela.
const COLLAPSE_THRESHOLD = 200;

function splitSummary(message: string): { summary: string; rest: string } {
  const stackMarker = message.search(/\s+at\s|\n|Logs:\s*>/);
  const cut = stackMarker > 20 ? stackMarker : Math.min(160, message.length);
  return { summary: message.slice(0, cut).trimEnd(), rest: message.slice(cut).trim() };
}

export function TerminalTab({ s }: { s: AppState }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const [draft, setDraft] = useState('');

  const send = () => {
    const text = draft.trim();
    if (!text || s.isExecuting) return;
    setDraft('');
    void s.handleUserReport(text);
  };

  return (
    <div className="terminal-wrap">
      <div className="terminal">
        {s.logs.map((log, i) => {
          const isUser = log.agent === 'user';
          const isLong = log.message.length > COLLAPSE_THRESHOLD;
          if (!isLong) {
            return (
              <div key={i} className={`log-line ${log.type} ${isUser ? 'user-message' : ''}`}>
                <span className="log-agent">[{isUser ? 'você' : log.agent}]</span> {log.message}
              </div>
            );
          }
          const { summary, rest } = splitSummary(log.message);
          const isOpen = expanded.has(i);
          return (
            <div key={i} className={`log-line log-line-collapsible ${log.type}`}>
              <span className="log-agent">[{log.agent}]</span>
              <span>
                {summary}
                {!isOpen && '…'}
                <button type="button" className="log-toggle" onClick={() => toggle(i)}>
                  {isOpen ? 'recolher' : `ver stack trace completo (${log.message.length} caracteres)`}
                </button>
                {isOpen && rest && <pre className="log-trace">{rest}</pre>}
              </span>
            </div>
          );
        })}
        <div ref={s.logsEndRef} />
      </div>
      <div className="terminal-chat-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
          disabled={s.isExecuting}
          placeholder={
            s.isExecuting ? 'Aguarde a etapa atual terminar…' : 'Fale com o Corretor — descreva o que quer ajustar…'
          }
          aria-label="Mensagem para o agente"
        />
        <button
          type="button"
          onClick={send}
          disabled={s.isExecuting || !draft.trim()}
          title="Enfileira o Corretor de Erros do Usuário com esta mensagem"
        >
          <Send size={13} /> Enviar
        </button>
      </div>
    </div>
  );
}
