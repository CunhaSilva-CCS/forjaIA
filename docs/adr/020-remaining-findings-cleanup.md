# ADR-020 — Restante do pente fino: os ~13 achados médios/baixos do ADR-019

**Status:** Aceito

## Contexto

O ADR-019 corrigiu os 2 críticos + 4 altos da auditoria de 4 agentes ("pente fino"), deixando ~14
achados médios/baixos documentados mas não corrigidos por escolha do usuário naquele momento. Pedido
de continuação: "sim, o restante dos bugs" — corrigir o que sobrou. Este ADR cobre os 13 achados que
eram bugs de verdade (excluindo `GET /api/llm/status` sem auth, que a própria auditoria concluiu ser
comportamento deliberado e testado, não um achado).

## Decisão

**`lib/llm.js` — `resolveReviewProvider` sempre caía pro Ollama.** `primary === 'ollama' ? primary :
'ollama'` é uma tautologia — os dois ramos do ternário resolvem pra `'ollama'`. Sem alternativa cloud
configurada, toda revisão sênior tentava Ollama primeiro mesmo sem ele rodando, contradizendo o
próprio comentário da função ("cai pro mesmo provedor da run"). Corrigido pra `return primary;`. O
teste que deveria ter pego isso usava `primary: 'ollama'` como cenário, onde os dois ramos do
ternário buggy coincidem — corrigido pra testar com `primary: 'claude'`.

**`lib/deployRuntime.js` — mesmo bug de pipe-morre-com-restart que o ADR-014 já tinha corrigido em
`mobileDeploy.js`, só que no caminho de deploy sem Docker** (`FORJA_REQUIRE_DOCKER=false`). O
subprocesso do app "deployado" tinha stdio ligado por pipe ao processo do ForjaIA — um restart do
servidor (rotina em desenvolvimento) quebrava o pipe e derrubava o app junto. Corrigido com o mesmo
padrão: `detached: true` + stdio redirecionado pra um arquivo real; `stopDeploy()` agora mata o GRUPO
de processos (PID negativo), não só o PID direto, mesmo ajuste que `mobileDeploy.js` precisou pro
`xcodebuild`/Metro não ficarem órfãos.

**`components/TokenGate.tsx` — token rejeitado ficava salvo no localStorage.** `setStoredToken()`
rodava incondicionalmente ANTES de validar contra o backend; um typo no token deixava o usuário
travado fora do app pra sempre (reload pula direto pro Dashboard, que 401 em tudo). Corrigido:
limpa o token salvo no `catch` de validação.

**`hooks/useForjaApp.ts` — reconexão de WebSocket podia apagar log ao vivo.** O handler de
`sync-state` buscava o histórico completo via REST e SUBSTITUÍA o array de logs inteiro quando a
resposta chegava — uma linha de `agent-log` que chegasse via WebSocket ENQUANTO esse fetch estava em
voo (run ativa continua logando) era apagada pela substituição, porque o snapshot buscado reflete o
momento da requisição, não da resposta. Corrigido: mescla em vez de substituir (o snapshot é a base,
qualquer linha ao vivo ainda não presente nele é preservada), com uma guarda extra por `currentRunId`
(via ref) pra não aplicar um fetch atrasado de uma run diferente da atual.

**`agent/human.js` — gate de aprovação tinha código morto e comparação de verdict frágil.** A
variável `passed` original era sempre um subconjunto lógico de `flowOk && !critical &&
surface.reachable` — `passed || X` sempre reduzia pra `X`, então aquela checagem nunca influenciava
o resultado. Na prática, o único jeito do LLM revisor vetar um teste humano de resto limpo era bater
o literal exato `'reprovado'`; qualquer variação de formatação ("Reprovado", "reprovado.") passava
batido. Corrigido: removida a variável morta, comparação de verdict normalizada
(`trim().toLowerCase().startsWith('reprovado')`).

**`index.css` — ~150 linhas de CSS órfão** de reescritas anteriores (AppHeader/LlmTokensCard/
TerminalTab dos ADR-013/017): `.status-indicator`, `.model-alert*`, `.model-status-badge`,
`.service-panel*`, `.agent-state`, `.token-legend*`, `.token-model-tag`, `.token-section*`,
`.user-report-field/-row`, `.deploy-label`, `.deploy-idle-glow` (+ a keyframe `deploy-breathe` que só
ela usava), `.glass-panel` (incluindo as duas combinações `header.glass-panel` e `.col-right >
.glass-panel`), `.log-line.compact`. Cada seletor foi confirmado com zero referência em `.tsx`/`.ts`
antes de remover. Bundle de CSS: 27.61kB → 24.34kB.

**`lib/export.js` — path de arquivo do zip sem sanitização (zip-slip defensivo).** `file.path` (do
banco, gerado pelo LLM) virava nome de entrada do zip sem checar traversal — diferente de
`devops.js`'s `writeSafely`, que já protege a escrita em disco real. O ForjaIA em si não é afetado
(só monta o zip), mas é defesa-em-profundidade pra quem extrai o download com uma ferramenta antiga/
ingênua. Corrigido: `path.posix.normalize` + rejeita (pula, loga aviso) qualquer entrada que ainda
comece com `..` ou `/` depois de normalizada.

**`agent/orchestrator.js` — `userFixInvoked` não sobrevivia a um restart.** O flag só existia em
memória; um restart do servidor no meio de uma run onde o usuário já tinha chamado o Corretor fazia
`computeReliability()` (ADR-012) contar essa run como "terminou sem intervenção" quando terminasse,
mascarando que houve intervenção humana. Corrigido: persistido em `savedConfig.userFixInvoked` no
`queueUserReport`, restaurado em `restorePendingApproval()`.

**`agent/stages/debuggerStage.js` — escrita duplicada no banco.** `persistTask({})` já grava
`config: this.savedConfig` incondicionalmente; o `runs.update(...)` explícito logo depois era uma
segunda escrita idêntica, resquício de antes de `persistTask` incluir `config` sempre. Removido.

**`lib/config.js` — checagem de produção não reconhecia o provedor `cursor`.** ADR-007 permite Cursor
autenticar via sessão local sem `CURSOR_API_KEY`, igual a `ollama` — mas o guard de produção só tinha
o caso especial pra `ollama`. Configurar `FORJA_LLM_PROVIDER=cursor` como default de produção travava
o startup mesmo com sessão local válida. Corrigido: `cursor` tratado como isento de chave, igual
`ollama`.

**`lib/secretScan.js` — regex de token conhecido sem flag `'g'`.** `code.match(pattern.regex)` sem
`'g'` só reporta a PRIMEIRA ocorrência; um segundo segredo distinto do mesmo tipo no mesmo arquivo
nunca era nem examinado. Corrigido: todas as `KNOWN_TOKEN_PATTERNS` ganharam `'g'`, loop trocado pra
`exec()` em `while`. A descrição de cada achado agora inclui o valor casado (não só o título
genérico) — sem isso, dois segredos DIFERENTES do mesmo tipo colapsariam num só achado pela dedup em
`push()` (por `id:file:description`); o mesmo segredo repetido continua contando como um achado só
(comportamento existente preservado).

**`components/WorkspaceTabs.tsx` — abas "Projetos" e "Equipe" com o mesmo ícone** (`Settings`
duplicado, provável copy-paste ao adicionar a aba de equipe). Equipe agora usa `Users`.

**`components/tabs/TerminalTab.tsx` — expand/collapse de stack trace chaveado por índice do
array.** Uma run nova troca o array de logs inteiro (`setLogs([])`); se uma mensagem longa da run
anterior estava expandida no índice 3 e a run nova também tem uma mensagem longa nesse mesmo índice,
ela renderizava pré-expandida sem nenhum clique (ou o inverso). Corrigido: chave de expandido agora é
o CONTEÚDO da linha (`timestamp|agent|message`), não a posição — uma run nova com conteúdo diferente
nunca colide com estado antigo.

## Consequências

- 9 testes novos cobrindo os achados com regressão real e concreta (não só "não quebrou nada"):
  `resolveReviewProvider` com provider não-ollama, `deployRuntime` com spawn mockado inspecionando
  `detached`/`stdio`, `TokenGate` checando `localStorage` após rejeição, gate de `human.js` com
  verdict "Reprovado" maiúsculo, `export.js` com paths de traversal, `orchestrator.js` com um
  segundo `Orchestrator` simulando restart, `config.js` com `NODE_ENV=production` real,
  `secretScan.js` com dois segredos distintos, `TerminalTab` com `rerender` trocando o array de
  logs. Backend: 219/219. Frontend: 102/102, build limpo.
- **Lacuna aceita conscientemente**: a corrida do `sync-state` em `useForjaApp.ts` não ganhou teste
  dedicado — o hook não tem suíte própria (nenhuma neste projeto até agora) e mockar
  `services/ws.ts`/`services/api.ts` pra um `renderHook` isolado só pra este fix seria desproporcional
  ao tamanho da mudança. Verificado por leitura + typecheck limpo + os 102 testes de componente
  existentes continuando verdes (nenhum depende do comportamento antigo). Mesma honestidade do
  ADR-014 sobre lacunas de cobertura conhecidas, não escondidas.
- Os gaps de teste em `PipelinePanel.tsx`/`HistoryTab.tsx` (achado #6 do agente de frontend no
  ADR-019, "0 testes apesar de lógica real") continuam sem cobertura — são lacuna de teste, não bug,
  e ficam fora do escopo deste ADR (que é sobre corrigir defeitos, não fechar lacunas de suite).
