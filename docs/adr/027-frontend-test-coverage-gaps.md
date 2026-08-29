# ADR-027 — Fecha as lacunas de cobertura de teste no frontend

**Status:** Aceito

## Contexto

A auditoria funcional ao vivo (mesma rodada que gerou o ADR-026) apontou três componentes/hooks
sem teste dedicado, todos com lógica não-trivial:

- `PipelinePanel.tsx` — cálculo de duração de etapa a partir de logs reais (`deriveStageDurations`),
  contagem de tentativas de cura, classes condicionais de trilho ativo/inativo por modo de pipeline.
- `HistoryTab.tsx` — exportação de run (`downloadExport`/`downloadReportPdf`) com tratamento de erro
  via toast, hoje sem nenhum teste cobrindo o caminho de falha.
- `useForjaApp.ts` — o hook central da aplicação, nunca testado isoladamente. Em especial, a lógica
  de mescla do `sync-state` (corrigida no ADR-020: mescla logs do snapshot com logs já recebidos ao
  vivo em vez de substituir) ficou documentada como lacuna aceita no ADR-022 e nunca ganhou teste.

## Decisão

Três arquivos de teste novos, sem alterar comportamento de produção:

- **`PipelinePanel.test.tsx`** (11 testes) — cobre os dois grupos de agentes, contador de cura só no
  nó do Curador, duração de etapa derivada de logs reais (não mocka `deriveStageDurations`), classe
  `active` só no agente certo, `track-inactive` do grupo Criação em modo `validate`, mensagem de
  aprovação vs. rótulo de status genérico, e o caso sem `taskStatus`.
- **`HistoryTab.test.tsx`** (8 testes) — lista vazia, truncamento de prompt, abrir run, export e PDF
  com sucesso E com falha (o achado real: sem tratamento, um erro de rede quebrava silenciosamente
  em vez de avisar o usuário via toast).
- **`useForjaApp.test.ts`** (5 testes, novo) — mocka toda a superfície de `api.*` consumida pelos
  efeitos de montagem do hook (docker/ollama/preferences/workspace/projetos/runs/health/
  equipe/board/confiabilidade/uso de LLM/auditoria/serviço) e `connectAgentSocket` (capturando o
  handler de mensagens sem abrir WebSocket real). Cobre:
  - smoke test — monta sem lançar, chega num estado ocioso coerente;
  - `sync-state` mescla logs do snapshot com logs já recebidos ao vivo, não substitui (fecha
    explicitamente a lacuna do ADR-022);
  - `sync-state` atrasado não vaza log de uma run antiga se o usuário já trocou de run antes do
    fetch resolver (guard de corrida, testado deliberadamente à parte da mescla);
  - `audit-started`/`audit-finished` rebuscam `auditRuns` (ADR-021/023);
  - `tokens-updated` atualiza `tokenStats` ao vivo, incluindo `estimatedCostUsd` (ADR-024).

## Consequências

- Frontend: 137/137 testes passando (era ~118 antes deste ADR), build de produção limpo
  (`tsc -b && vite build`).
- O teste de corrida do `sync-state` é o mais valioso e o mais frágil: depende da ordem exata de
  resolução de promises (`resolveGet` mantido em escopo de teste, resolvido manualmente após um
  `task-started` simular a troca de run). Se o hook for refatorado para usar outra estratégia de
  cancelamento (ex.: `AbortController` em vez de comparação de id), este teste precisa ser reescrito
  junto — ele testa o comportamento observável (não vazar log da run errada), não a implementação
  específica.
- Não cobre: `useServiceControl.ts` e `useFolderBrowser.ts` isoladamente (ambos pequenos,
  comportamento simples de polling/chamada direta, risco baixo) — deliberadamente fora de escopo
  deste ADR para não inflar teste por cobertura numérica sem achado real por trás.
