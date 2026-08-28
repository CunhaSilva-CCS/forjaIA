import { useState } from 'react';
import { Send } from 'lucide-react';
import type { AppState } from '../../hooks/useForjaApp';
import type { LogLine } from '../../types/agent';

// Mensagens de erro do backend costumam embutir o stack trace inteiro do
// processo filho (docker/ts-node) na mesma string da narração. Acima desse
// tamanho, a linha vira "resumo + alternar" em vez de despejar tudo na tela.
const COLLAPSE_THRESHOLD = 200;

function splitSummary(message: string): { summary: string; rest: string } {
  const stackMarker = message.search(/\s+at\s|\n|Logs:\s*>/);
  const cut = stackMarker > 20 ? stackMarker : Math.min(160, message.length);
  return { summary: message.slice(0, cut).trimEnd(), rest: message.slice(cut).trim() };
}

// Identidade estável da linha pelo CONTEÚDO (não a posição no array) — usada tanto pra key do
// React quanto pro estado de expandido/recolhido. Achado real: chaveado por índice, uma run
// nova trocava o array de logs (setLogs([])) mas o índice 3 podia coincidir com outra mensagem
// longa e renderizar pré-expandida sem clique nenhum, ou vice-versa. Duas linhas com conteúdo
// idêntico compartilharem o estado de expandido é um efeito colateral aceitável — são a mesma
// mensagem, então tratá-las igual não é surpreendente do jeito que reusar um índice era.
function logKey(log: LogLine): string {
  return `${log.timestamp || ''}|${log.agent}|${log.message}`;
}

export function TerminalTab({ s }: { s: AppState }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
          const key = logKey(log) + `#${i}`;
          const isUser = log.agent === 'user';
          const isLong = log.message.length > COLLAPSE_THRESHOLD;
          if (!isLong) {
            return (
              <div key={key} className={`log-line ${log.type} ${isUser ? 'user-message' : ''}`}>
                <span className="log-agent">[{isUser ? 'você' : log.agent}]</span> {log.message}
              </div>
            );
          }
          const { summary, rest } = splitSummary(log.message);
          const toggleKey = logKey(log);
          const isOpen = expanded.has(toggleKey);
          return (
            <div key={key} className={`log-line log-line-collapsible ${log.type}`}>
              <span className="log-agent">[{log.agent}]</span>
              <span>
                {summary}
                {!isOpen && '…'}
                <button type="button" className="log-toggle" onClick={() => toggle(toggleKey)}>
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
