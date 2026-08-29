# ADR-026 — Corretor escala de provedor + consistência de sistema de módulos na constituição

**Status:** Aceito

## Contexto

Dois achados da auditoria funcional ao vivo (rodei o pipeline inteiro contra um projeto real,
observando cada etapa, não só testes automatizados): o Corretor do Usuário falhou 4 vezes seguidas
em Ollama local antes de acertar na 5ª, e — na mesma run — uma inconsistência real entre
`package.json` (marcado `"type":"module"` por uma rodada de cura anterior) e `server.js`
(reescrito em CommonJS por uma rodada seguinte do Corretor) derrubou a sandbox de carga com
`ReferenceError: require is not defined in ES module scope`.

## Decisão

**Escalada de provedor no Corretor** (`agent/userFix.js`, `agent/stages/userFixStage.js`,
`agent/orchestrator.js`): mesmo raciocínio do Curador (ADR-013) — insistir no mesmo provedor que
já falhou tende a repetir o mesmo erro. Novo contador `orchestrator.userFixAttempts` (mesmo padrão
de `healingAttempts`: incrementado em sucesso E falha, persistido em `savedConfig`, restaurado após
restart). A partir da 3ª tentativa, `userFixStage.js` passa `escalateProvider: true` pro
`userFix.execute`, que troca `runConfig.llmProvider` via `resolveReviewProvider` (mesmo helper de
diversidade do ADR-011) — sem teto pra desistir (diferente do Curador): o Corretor responde a um
relato específico do usuário, não faz sentido silenciosamente seguir em frente sem resolver.

**Consistência de sistema de módulos** (`lib/seniorEngineer.js` — `CONSTITUTION`, item 10 do
checklist de produção, injetado em TODO agente que escreve código): investigando a causa raiz antes
de "corrigir" — descobri que `package.json` já era SEMPRE incluído por completo no contexto enviado
tanto por `healer.js` quanto por `userFix.js` (`if (pkg) selectedPaths.add(pkg.path);`, já existia
nos dois). Não era falta de contexto — o LLM via o `"type":"module"` e mesmo assim escrevia
`require()`. A causa real: nenhum prompt em lugar nenhum instruía explicitamente a manter o sistema
de módulos consistente. Corrigido na constituição compartilhada (afeta arquiteto, codificador,
curador e corretor de uma vez, sem precisar editar cada agente).

## Consequências

- 7 testes novos: 3 em `userFixStage` (não escala nas 2 primeiras tentativas, escala na 3ª, falha
  também conta pro contador — mesmo bug que `healerStage.js` já tinha corrigido antes do ADR-013),
  2 em `userFix.js` (escalateProvider troca de verdade o provedor / sem ele usa o pedido), 1 na
  constituição (a regra está presente pros papéis que escrevem código), mais os já existentes.
  Backend: 269/269.
- A regra de módulos é texto de prompt — não dá pra testar unitariamente "o LLM obedece". O teste
  garante que a INSTRUÇÃO existe no prompt final, não que o modelo vai segui-la sempre; é
  mitigação, não garantia (mesma honestidade sobre limitação de LLM que o resto do projeto já
  assume nos ADRs de reliability).
- `userFixAttempts` é monotônico durante a run inteira (mesmo padrão de `healingAttempts`) — não
  reseta entre ciclos de correção dentro da mesma run, só num run novo.
