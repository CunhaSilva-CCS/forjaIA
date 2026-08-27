# ADR-001 — Extrair estágios do orchestrator em módulos separados

**Status:** Aceito

## Contexto

`backend/agent/orchestrator.js` concentrava, num único arquivo de 1341 linhas, a state machine do pipeline, persistência em SQLite, broadcast via WebSocket, RBAC de aprovação, e a lógica de negócio das 11 etapas do pipeline (coder, qa, security, debugger, healer, devops, deploy, human, userFix, prodReady, report). Nenhum teste exercitava o dispatcher `runStage`/`approveAndContinue` fim a fim — mudar uma etapa exigia entender o arquivo inteiro, e não havia como testar uma etapa isoladamente.

## Decisão

Cada etapa do switch em `runStage()` virou um módulo próprio em `backend/agent/stages/*.js`, exportando uma função `run(orchestrator, runConfig)` com exatamente o mesmo corpo que tinha antes — nenhuma lógica foi alterada, só movida. O `orchestrator.js` ficou com o dispatcher fino (`require('./stages/xStage').run(this, runConfig)`) e as responsabilidades que são genuinamente cross-cutting (persistência, broadcast, `pauseForApproval`, `writeFilesToWorkspace`, `queueUserReport`).

Não foi extraído: `run()` (bootstrap do modo forge, chama o Arquiteto diretamente) e `validateExisting()` (bootstrap do modo validate) continuam no orchestrator, porque são pontos de entrada, não etapas do switch.

## Consequências

- `orchestrator.js` caiu de 1341 para 877 linhas.
- Cada estágio agora é testável isoladamente com um orchestrator fake (ver `backend/test/orchestratorStages.test.js`, 20 testes cobrindo os ramos de decisão de cada etapa — inclusive os de falha/retry que não tinham nenhuma cobertura antes).
- Risco de regressão ao mexer numa etapa caiu: o blast radius de uma mudança em `stages/healerStage.js` não exige reler as outras 10 etapas.
- Trade-off aceito: mais arquivos pequenos para navegar em troca de menos acoplamento. Para quem já conhecia o arquivo único, há uma curva de "onde está isso agora" — mitigada pelo nome do arquivo bater 1:1 com o nome da etapa no `STAGE_LABELS`.
