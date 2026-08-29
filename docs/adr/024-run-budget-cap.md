# ADR-024 — Teto de orçamento estimado por run, reusando o gate de aprovação existente

**Status:** Aceito

## Contexto

Terceiro ponto da lista "o que falta pra confiar no ForjaIA": o pipeline tem cura com retry,
revisão sênior e várias chamadas de LLM por etapa — numa run ruim (muitas tentativas de cura), o
custo composto pode surpreender. O ADR-017 já dá VISIBILIDADE real de uso por provedor, mas nada
PARA a run antes dela estourar um valor que o usuário considera aceitável.

## Decisão

**`lib/llmPricing.js`** (novo): tabela de preço aproximado (USD por 1M tokens, prompt/completion
separados) pros modelos conhecidos, com fallback por provedor pra modelo desconhecido, e `null`
(não finge um número) pra provedor totalmente desconhecido. Documentado explicitamente como
ESTIMATIVA, não fatura real — mesma limitação já aceita no ADR-017 (nenhum provedor expõe isso por
API). Ollama/Cursor sempre custo zero (local / assinatura, não por token).

**Acumulação por run** (`orchestrator.recordTokens`): a cada chamada de LLM concluída, soma o
delta estimado em `currentTask.tokenStats.estimatedCostUsd`. Se `savedConfig.budgetUsd` (por run,
setável no início ou numa aprovação) ou `config.runBudgetUsd` (default do servidor,
`FORJA_RUN_BUDGET_USD`, 0 = desligado) estiver configurado e o acumulado passar do teto, marca
`currentTask.budgetExceeded = true` — não lança direto dali.

**Por que não lançar direto de `recordTokens`**: alguns chamadores (`thinkAsSenior`) engolem
exceção própria num try/catch que trata qualquer falha como "LLM indisponível, seguindo com
análise heurística" — um `throw` ali nunca chegaria no `pauseForApproval` do orchestrator, o
orçamento estourado passaria batido. Em vez disso, `throwIfAborted()` — já chamado no início de
toda etapa do pipeline, o mesmo checkpoint cooperativo usado pra cancelamento — também checa o
flag e lança lá. Resultado: a run para na PRÓXIMA fronteira de etapa (não no meio de uma chamada de
LLM em andamento), com uma mensagem clara, e cai automaticamente no MESMO mecanismo de "etapa
interrompida, aprove pra tentar de novo" que qualquer outro erro de etapa já usa — nenhum código
novo de pausa foi necessário.

**Aprovar É o ato de autorizar continuar**: `approveAndContinue` reseta `budgetExceeded = false`
incondicionalmente ao aprovar — não exige que o humano prove que "levantou o teto" antes; se o
gasto real continuar acima do orçamento, a próxima chamada de LLM marca o flag de novo e a run
pausa de novo na etapa seguinte. Isso segue exatamente a mesma semântica de todo outro gate do
pipeline (clicar aprovar = autorizar o próximo incremento de trabalho). O humano também pode
mandar um `budgetUsd` novo no corpo do approve pra efetivamente levantar o teto, se quiser parar de
ser interrompido.

**UI**: campo "Orçamento (USD, opcional)" no painel Ordem (`OrderPanel.tsx`), vazio = sem teto —
value flui pra `runConfig().budgetUsd` em toda chamada de `handleRun`/`handleValidateExisting`/
`handleApprove`. O card "LLM & tokens" mostra o gasto estimado da run atual (só quando > 0), com o
teto configurado ao lado quando houver.

## Consequências

- 13 testes novos: `llmPricing.test.js` (estimativa por modelo conhecido/desconhecido/provedor
  desconhecido, ollama/cursor sempre zero), `budgetCap.test.js` (achado real do flag marcado
  corretamente pelo acumulado real, `throwIfAborted` lançando sem `.cancelled`, teto desligado
  nunca marca o flag, `approveAndContinue` resetando o flag e aceitando `budgetUsd` novo), mais
  testes de componente pro campo novo e pra exibição do gasto. Backend 253/253, frontend 113/113.
- **Estimativa, não cobrança real** — se a tabela de preço em `llmPricing.js` ficar desatualizada
  (provedor muda preço), o teto vira impreciso silenciosamente. Mitigação parcial: provedor
  desconhecido não soma nada ao total (fail-open na direção "não trava por engano"), consistente
  com a filosofia do ADR-017 de nunca inventar um número quando não há certeza.
- O gasto SEMPRE já aconteceu antes do teto reagir — não existe como saber o custo de uma chamada
  antes dela responder (tokens só são conhecidos depois). O teto impede a PRÓXIMA chamada, não a
  que disparou o estouro; aceito, é a mesma limitação de qualquer sistema reativo a dado real (ver
  ADR-017), e a alternativa (estimar tokens antes de mandar o prompt) seria impreciso do mesmo jeito.
- Nenhuma mudança em `agent/*.js` além do que já chamava `recordTokens` — o gate inteiro vive em
  `orchestrator.js` + `llmPricing.js`, sem tocar em nenhum agente individual.
