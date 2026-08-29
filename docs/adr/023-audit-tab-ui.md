# ADR-023 — Aba "Auditoria" na UI, fechando o loop do ADR-021

**Status:** Aceito

## Contexto

O ADR-021 deu ao ForjaIA uma auditoria independente (Semgrep + npm audit), mas só via CLI/API — pra
ver o resultado era preciso lembrar de rodar `npm run audit:self` ou chamar a API direto. Pedido do
usuário como continuação direta da conversa "posso confiar no ForjaIA?": mostrar isso na interface,
não só documentado — pra virar algo que se consulta olhando a tela, não algo que só existe se
alguém lembrar do comando.

## Decisão

**Nova aba "Auditoria"** (`components/tabs/AuditTab.tsx`), ao lado de Segurança/ADRs/Histórico —
não um card fixo na coluna direita, porque a auditoria é uso ocasional (dispara quando quer), não
estado ao vivo de uma run em andamento (diferente de Deploy/Testes/LLM, que são sobre a run atual).

**Dois botões de disparo**: "Auditar o ForjaIA" (`target=self`, sempre habilitado) e "Auditar
projeto atual" (`target=project`, usa o campo Destino já existente no formulário de Ordem —
desabilitado com tooltip explicando o motivo quando não há projeto selecionado, em vez de
simplesmente não fazer nada ao clicar).

**Lista de runs** com card por execução: alvo, status (`Rodando…`/`Concluída`/`Falhou`), resumo,
achados expansíveis por clique (severidade colorida — `.sev.critical`/`.sev.moderate` novos no CSS,
já que os achados de `npm audit` usam esse vocabulário, diferente do `HIGH/MEDIUM/LOW` do restante
do pipeline), e o motivo de qualquer ferramenta pulada (ex.: "semgrep: não está instalado").

**Ao vivo via WebSocket**: `POST /api/audit/run` já retorna na hora (roda em background) e o
backend já transmite `audit-started`/`audit-finished` (ADR-021) — o hook só precisava ESCUTAR:
`handleWsMessage` ganhou um case novo que rebusca `GET /api/audit/runs` nesses dois eventos, mesmo
padrão que `tokens-updated` já usa pra manter o card de LLM/tokens vivo sem essa lógica precisar
estar no dependency array do `useCallback` (chama a API inline, não uma função memoizada declarada
depois no arquivo — evita o problema de ordem de declaração).

## Consequências

- **Verificado ao vivo, ponta a ponta, não só testado com mock**: subi o serviço em modo dev
  (`FORJA_REQUIRE_DOCKER=false`, Docker Desktop não estava rodando nesta máquina), logei via
  Playwright real, cliquei em "Auditar o ForjaIA" de verdade contra o backend real, esperei a run
  terminar (Semgrep real rodando contra o repo inteiro) e confirmei que o card virou "Concluída —
  nenhum achado" SEM reload de página — a atualização via WebSocket funciona de ponta a ponta.
  "Nenhum achado" bate com o ADR-021 (as supressões `nosemgrep` documentadas lá continuam válidas).
- 7 testes novos de componente (`AuditTab.test.tsx`) cobrindo: estado vazio, disparo de auditoria
  self/project, botão desabilitado sem destino, expandir/recolher achados, exibição de erro numa
  run falhada, e exibição do motivo de ferramenta pulada.
- Frontend: 109/109 testes, build limpo.
- Achado incidental durante a verificação ao vivo (não deste ADR, ambiente): `CORS_ORIGIN` no `.env`
  aponta pra `http://127.0.0.1:3001` (produção, mesma origem) — em modo dev (Vite em `:5173`) isso
  bloqueia `fetch` por CORS. Não é um bug do ForjaIA em si (dev mode sempre teve esse requisito de
  configurar `CORS_ORIGIN` à parte), só uma nota registrada aqui pra não redescobrir na próxima vez
  que alguém for testar a UI em modo dev.
