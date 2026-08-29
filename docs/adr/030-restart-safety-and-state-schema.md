# ADR-030 — Segurança de restart sistemática + esquema canônico de estado de run

**Status:** Aceito

## Contexto

O achado que motivou este ADR: `deployTargets` (simulatorUdid/bundleId do deploy mobile, ver
ADR-018) existia no resultado de `devops.deployMobile` há tempo, mas nunca era persistido nem
restaurado — só descobri implementando o teste humano mobile (ADR-029), quase por acidente, porque
foi a primeira vez que algo LIA esse campo de `currentTask` depois de um restart hipotético. Não é
a primeira vez: `userFixInvoked` teve o mesmo tipo de lacuna antes do ADR-020.

O padrão de fundo: `orchestrator.currentTask`/`orchestrator.savedConfig` cresceram como uma sacola
de campos, cada estágio novo adicionando os seus por convenção (`orchestrator.savedConfig = {
...orchestrator.savedConfig, meuCampoNovo: x }`), sem nada garantindo que (a) o campo realmente
entra no `savedConfig` persistido, e (b) `restorePendingApproval()` bota ele de volta em
`currentTask` se algum código lê direto de lá (não de `savedConfig`). Cada instância desse bug só
foi achada por dogfooding manual — rodar o pipeline de verdade e notar que algo sumiu depois de um
restart. Isso não escala: quanto mais ADRs o projeto acumula, mais lugares esse esquecimento pode
se esconder.

## Decisão

**`backend/test/restartSafety.test.js`** (novo): testa a costura frágil diretamente, contra o
`Orchestrator` DE VERDADE (não uma versão fake) ligado a um SQLite temporário real — não simula
"restart", provoca um de verdade: roda um estágio real até ele pausar pra aprovação (persistindo
via `pauseForApproval`/`persistTask` reais), depois instancia um **segundo** `Orchestrator` apontado
pro mesmo banco (o construtor dele chama `restorePendingApproval()` de verdade) e compara o estado
antes/depois. Cobre 9 gates: `deployStage→humanStage` (deployTargets — o achado que motivou isto),
`humanStage→userFix` (humanReport com issues), `healerStage` (healingAttempts), `userFixStage`
(userFixAttempts + userFixInvoked), `debuggerStage→healerStage` (lastDiagnosis),
`orchestrator.run()→coderStage` (savedPlan/adrs — o PRIMEIRO gate da run inteira),
`qaStage→securityStage` (lastTestReport — confirma que o veredito `passed` reconstruído bate com o
original, não um recálculo divergente), `securityStage→devops/debugger` (lastSecurityReport),
`prodReadyStage→report` (productionReady/gitBranch/prUrl — este confirma que o fallback pro
`savedConfig` funciona de ponta a ponta, já que `productionReady` não tem restauração explícita em
`currentTask`, só o fallback no ponto de leitura).

Validei que o teste tem dente de verdade: comentei temporariamente a linha que persiste
`deployTargets` em `deployStage.js`, rodei a suíte — o teste de restart falhou exatamente como
esperado — depois desfiz e confirmei que volta a passar. Um teste que nunca falha quando deveria
não vale nada; esse já provou que teria pego o bug original antes de eu precisar achar na mão.

**Regra pra estágios futuros** (documentada aqui, reforçada pelo teste acima): se um estágio grava
`orchestrator.currentTask.X` e algum código lê `orchestrator.currentTask.X` diretamente (não via
`orchestrator.savedConfig?.X`), esse estágio PRECISA fazer as duas coisas — incluir `X` no
`orchestrator.savedConfig` (pra sobreviver no banco) E adicionar uma linha em
`restorePendingApproval()` restaurando `currentTask.X` de `row.config?.X`. A alternativa mais barata
e já usada em vários lugares (`emitReportPdf`, e agora `humanStage.js` pro `deployTargets`) é o
próprio código que LÊ o campo já cair pra `orchestrator.savedConfig?.X` como fallback quando
`currentTask.X` está ausente — como `savedConfig` já é populado por completo via
`{...(row.config||{})}` na restauração, esse fallback funciona automaticamente sem precisar de uma
linha nova em `restorePendingApproval()` a cada campo novo. Adicionei esse fallback em
`humanStage.js` como defesa em profundidade, além da restauração explícita que o ADR-029 já tinha
adicionado.

**Checklist de integração com ferramenta externa** (`docs/adr/README.md`, topo do arquivo): daqui
pra frente, todo ADR que integra uma ferramenta externa nova (CLI, servidor, driver — o padrão já
estabelecido informalmente com Playwright/ADR-022 e Appium/ADR-029) precisa de uma seção
"Verificação ao vivo" descrevendo o que foi testado contra a ferramenta REAL, não só contra
mock/fake server. Não é burocracia nova — é nomear o que este projeto já vinha fazendo bem (achou 2
bugs reais no ADR-029 que nenhum mock pegaria) e parar de deixar isso à mercê de quem lembrar de
fazer.

## Verificação ao vivo (retroativa) do checklist — `windowsDeploy.js` (ADR-018)

Aplicando o checklist recém-criado num caso pré-existente que nunca tinha sido verificado: o
ADR-018 implementou `triggerWindowsBuild` (dispara `gh workflow run`, acompanha via `gh run view`)
mas só tinha teste com `gh` mockado — nunca rodou contra o GitHub Actions de verdade. Criei um
repositório descartável (`forja-windows-deploy-verify-tmp`, apagado ao final) com uma pasta
`windows/` mínima e um workflow real (`windows-latest`, `workflow_dispatch`), e rodei
`triggerWindowsBuild` de verdade contra ele — dois cenários: build que passa (disparou, acompanhou,
retornou `{ type: 'windows-ci', runId, runUrl }` corretamente) e build que falha de propósito
(rejeitou com a mensagem e `runUrl` certos). **Nenhum bug encontrado desta vez** — diferente do
Appium (ADR-029), a implementação já estava correta contra a API real; a lacuna era só a ausência
da verificação em si, agora preenchida.

## Consequências

- Backend: 298/298 (9 testes em `restartSafety.test.js`, expandido de 5 pra 9 gates nesta mesma
  sessão).
- `restartSafety.test.js` cobre 9 gates conhecidos, não todos os pontos de pausa possíveis do
  pipeline (faltam, por exemplo, `coderStage→qaStage` isolado e `validateExisting→qaStage`, ambos
  de menor risco por não introduzirem campo novo além do genérico `files`) — é cobertura ampla, não
  completa. Novo campo em `savedConfig`/`currentTask` que precise sobreviver a restart deveria
  ganhar um teste aqui também, seguindo o mesmo molde (rodar estágio real → instanciar segundo
  Orchestrator → comparar).
- O checklist de "Verificação ao vivo" é processo, não código — depende de disciplina continuada
  pra valer, igual o resto da cultura de ADR do projeto já depende. A verificação do
  `windowsDeploy.js` acima é a primeira aplicação retroativa dele, prova de que não é só papel.
