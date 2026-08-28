# ADR-012 — Instrumentação de confiabilidade medida por run

**Status:** Aceito

## Contexto

O usuário perguntou qual a porcentagem de confiabilidade de um software feito pelo ForjaIA. A
resposta honesta era: não existe esse número, porque o pipeline não registra, de forma agregável,
se uma run terminou sem intervenção, quantas vezes o Curador precisou agir, ou o que
QA/Segurança/Humano encontraram. Sem isso, qualquer percentual seria estética, não medição.

## Decisão

Instrumentação mínima, só com o que já é observado durante uma run — nenhuma estimativa, nenhuma
heurística nova de "qualidade":

**`lib/reliability.js`** (novo) — `computeReliability({ healingAttempts, userFixInvoked, summary
})`, função pura, deriva um objeto `reliability` a partir de dados que o pipeline já calcula (o
`summary` já existia em `agent/reporter.js`, usado pra montar o PDF). `finishedWithoutIntervention`
é verdadeiro só se: zero tentativas de cura, nenhum relato manual do usuário via `queueUserReport`
(agent/orchestrator.js — ganhou uma flag `userFixInvoked`, resetada a cada novo run), zero teste
QA falho, zero achado de segurança no relatório final, e o Humano não reprovou (`humanPassed !==
false` — `null`, quando a etapa Humano não roda, não bloqueia).

**Persistência** — nova coluna `reliability_json` em `runs` (mesmo padrão de `metrics_json`/
`performanceMetrics` já existente), calculada uma vez por run dentro de
`Orchestrator.emitReportPdf()` (o ponto onde `summary` já fica disponível) e persistida via
`persistTask()`.

**Agregação** — `runs.reliabilityStats()` (`lib/db.js`) varre só as runs com `reliability_json`
preenchido (nunca extrapola runs não instrumentadas) e calcula: taxa de runs concluídas sem
intervenção, média de tentativas de cura, taxa de relato manual do usuário, taxa média de teste QA
aprovado, taxa de aprovação do Humano. Exposto via `GET /api/runs/stats/reliability`.

## Consequências

- O número só existe depois que houver volume real de runs completas passando pelo Relatório —
  hoje começa em `measuredRuns: 0`. É intencional: não inventa um número antes de ter dado.
- Runs antigas (antes deste ADR) não têm `reliability_json` e nunca vão ganhar retroativamente —
  ficam de fora da agregação para sempre, o que é correto (não dá pra reconstruir
  `healingAttempts`/`userFixInvoked` histórico com precisão).
- `finishedWithoutIntervention` é uma definição objetiva e auditável, mas ainda não cobre tudo (ex.:
  não sabe se o usuário ficou insatisfeito com o resultado sem usar o botão de relato) — é um
  proxy, documentado como tal, não uma métrica de satisfação.
