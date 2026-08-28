# ADR-016 — userFix.js manda só os arquivos relevantes, não o codebase inteiro

**Status:** Aceito

## Contexto

Pedindo pro Corretor (userFix) aplicar 3 correções pontuais no secPass (183 arquivos reais), a
etapa ficou travada por mais de 10 minutos sem nenhum log de progresso. Investigando, o payload
que `agent/userFix.js` monta manda `JSON.stringify` de TODOS os arquivos do projeto, com conteúdo
completo, sempre — sem nenhuma seleção. Medido diretamente contra o secPass: **~505 mil tokens**
numa única chamada, bem acima do contexto de qualquer provedor configurado, mesmo pra um relato
que citava só 3 arquivos por nome.

`agent/healer.js` já resolve exatamente esse problema desde antes desta sessão (motivado por outro
achado: "reenviar o codebase inteiro a cada cura é caro e lento") — manda só os arquivos apontados
pelo Depurador/Segurança + quem os importa, resto só por path. `userFix.js` nunca ganhou o mesmo
tratamento porque seu gatilho é texto livre de usuário, não um relatório estruturado com
`file` por achado.

## Decisão

`collectFlaggedPathsFromReport(knownPaths, userReport, humanReport)` (`agent/userFix.js`, novo) —
acha paths mencionados no TEXTO do relato (caminho completo ou só o nome-base do arquivo) e
paths de `humanReport.issues[].file` quando presente. `execute()` reaproveita `findDependents` já
exportado por `agent/healer.js` (mesma lógica, sem duplicar) pra também incluir quem importa os
arquivos sinalizados, e monta o prompt no mesmo formato que o healer já usa: conteúdo completo só
dos arquivos relevantes, resto listado só por path (o LLM ainda pode pedir um arquivo fora da
lista se descobrir que precisa, usando o path exato). Sem nada reconhecível no relato, cai pro
comportamento anterior (codebase completo) — não regride o caso onde o usuário descreve um
comportamento sem citar arquivo nenhum.

De brinde, achado o mesmo bug já corrigido no healer.js (ver ADR-014): um item de resposta do LLM
sem `path` válido quebrava `path.basename(undefined)` mais adiante. Mesma correção aplicada aqui —
filtra itens sem path válido antes de processar.

## Consequências

- Validado contra o secPass real: 505 mil tokens → ~2,2 mil tokens pro mesmo relato (3 arquivos
  citados por nome) — reduz o payload em ~228x.
- Relatos que não citam nenhum arquivo específico (ex.: "o app trava ao abrir") continuam mandando
  o codebase inteiro — correto, é o único jeito de o LLM achar o problema sem uma pista de onde
  procurar. Isso significa que relatos vagos em projetos grandes continuam caros; melhorá-los fica
  fora do escopo deste ADR.
