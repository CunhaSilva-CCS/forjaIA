# ADR-013 — Card de confiabilidade na UI + escalada de provedor na última cura

**Status:** Aceito

## Contexto

Duas melhorias sugeridas pelo próprio avaliador crítico do projeto (ver ADR-012), priorizadas por
custo/risco baixo e alto retorno prático:

1. A instrumentação de confiabilidade (ADR-012) só existia como JSON cru em
   `/api/runs/stats/reliability` — sem superfície na UI, o número de verdade que o usuário pediu
   ficava invisível no uso do dia a dia.
2. A diversidade de provedor (ADR-011) só vale para a revisão sênior — Arquiteto/Codificador/
   Depurador/Curador continuam sempre no mesmo provedor da run, por design (não arriscar
   qualidade). Isso deixa um ponto cego específico: se o Curador falha a cura 2x seguidas com o
   mesmo modelo, insistir uma 3ª vez com o mesmo modelo tende a repetir o mesmo raciocínio errado.

## Decisão

**1. `ReliabilityCard`** (`frontend/src/components/ReliabilityCard.tsx`, novo) — consome
`api.runs.reliabilityStats()`, mostra taxa de conclusão sem intervenção, runs medidas, média de
tentativas de cura, taxa de relato manual, taxa de QA aprovado e taxa de aprovação do Humano.
Busca no mount e refaz a busca automaticamente quando uma run termina (`task-completed` no
WebSocket) — sem esperar o usuário clicar em nada pra ver o número atualizado. Posicionado no
`col-right` do `App.tsx`, entre LLM & Tokens e Regras.

**2. Escalada de provedor na última tentativa de cura** — `healerStage.js` calcula
`isLastAttempt = attempt >= maxHealingAttempts` (a tentativa que, se falhar, encerra o loop de
cura) e passa `escalateProvider: isLastAttempt` no `runConfig` de `healer.execute`.
`agent/healer.js` reutiliza `resolveReviewProvider` (mesmo mecanismo do ADR-011, não uma lógica
nova) só quando essa flag está ligada, trocando de provedor especificamente na última chance antes
de desistir — nunca nas tentativas 1 e 2, onde manter o mesmo provedor (mais previsível, mais
barato de contexto/cache) ainda é a escolha certa.

## Consequências

- O card de confiabilidade começa vazio (`measuredRuns: 0`) até a primeira run instrumentada
  chegar no Relatório — mensagem explícita disso na UI, não um placeholder enganoso.
- A escalada de provedor na última cura só se aplica quando há alternativa cloud configurada (mesma
  regra de `resolveReviewProvider`); sem alternativa, cai pro mesmo provedor, comportamento
  idêntico ao anterior.
- Trocar de provedor na tentativa final significa que o "estilo" de correção pode mudar
  abruptamente entre a 2ª e a 3ª tentativa (modelos diferentes tendem a estruturar patches de
  forma diferente) — aceito como trade-off: nesse ponto a alternativa é desistir mesmo, então o
  risco de uma abordagem diferente vale a pena.
