# ADR-021 — Auditoria independente (Semgrep + npm audit), separada do pipeline

**Status:** Aceito

## Contexto

Depois do ADR-019/020 (pente fino corrigindo 2 críticos + 4 altos + 13 médios/baixos, tudo achado
por raciocínio semântico — ler código, traçar dado até o sink), o usuário perguntou se dava pra
confiar no ForjaIA. Resposta honesta: a auditoria de hoje foi só raciocínio de LLM (eu, com mais
agentes Claude) — nenhuma ferramenta determinística rodou. Faltava uma camada que não depende de um
LLM "achar" que algo é perigoso: SAST por regra (Semgrep) e checagem de dependência vulnerável
conhecida (`npm audit`), nenhuma das duas presente no pipeline até agora.

Pedido de acompanhamento: incluir essas auditorias no próprio ForjaIA, rodando **separadas** do
fluxo normal (arquiteto→codificador→QA→segurança→...). Motivo direto: o SAST que já existe em
`agent/security.js` + `lib/secretScan.js` é heurístico e roda em TODA run (tem que ser rápido,
minutos no máximo); Semgrep é mais lento (pode levar dezenas de segundos a minutos na primeira vez)
e mais pesado — colocar isso no meio de uma run de forja seria um gargalo real, não uma melhoria.

## Decisão

**Núcleo puro** (`lib/independentAudit.js`): `runIndependentAudit({ target, targetDir })` roda
Semgrep e `npm audit` em paralelo contra um diretório já resolvido, sem saber nada de HTTP/DB/auth
— testável isolado. `target` é `'self'` (o próprio ForjaIA — `resolveSelfTargetDir()` aponta pra
raiz do repo) ou `'project'` (um projeto forjado/validado qualquer).

- **Semgrep**: `checkSemgrepAvailable()` detecta se está instalado (`semgrep --version`); se não,
  o achado é pulado com `skippedReason` explícito, nunca um erro — mesmo padrão de degradação
  graciosa que `supportsMacCatalyst`/`supportsWindows` (ADR-018) já usam pra ferramenta externa
  opcional. Ruleset configurável via `FORJA_SEMGREP_CONFIG` (default `p/security-audit`).
- **npm audit**: `target='self'` roda em TRÊS diretórios separados (raiz, `backend/`, `frontend/`
  — o repo não é um monorepo de workspaces npm, cada um tem seu próprio `package-lock.json`);
  `target='project'` roda só na raiz do projeto. Achado real ao implementar: `npm audit` sai com
  código de saída ≠ 0 quando ACHA vulnerabilidade (não é falha da ferramenta) — o parser tenta ler
  `stdout` mesmo num `catch`, mesmo padrão que `windowsDeploy.js`/outros já usam pra comando que
  "falha" com sinal útil no próprio erro.

**Persistência** (`auditRuns` no mesmo módulo, tabela `audit_runs` nova, mesmo padrão de
`llmUsage.js`: módulo dono do próprio schema, `ensureAuditTables` plugado em `db.js`): cada
disparo vira uma linha (`running` → `completed`/`failed`), independente da tabela `runs` do
pipeline principal — são conceitos diferentes, não uma "run" de forja.

**Dois gatilhos, como pedido**:
1. **API/UI**: `POST /api/audit/run` (`{ target, projectPath? }`, atrás do `authMiddleware` normal)
   dispara em background (não bloqueia a resposta HTTP — Semgrep pode ser lento) e retorna
   `{ id, status: 'running' }` na hora; `GET /api/audit/runs` / `GET /api/audit/runs/:id` consultam
   o progresso/resultado. `target='project'` valida `projectPath` com `resolveWithinWorkspace` —
   o MESMO guard de traversal que toda outra rota que toca filesystem de projeto já usa (o
   pente fino do ADR-019 confirmou que esse helper é robusto).
2. **CLI**: `scripts/independentAudit.js` (`npm run audit:self` / `npm run audit:project -- --path
   <dir>`) roda direto, sem precisar do servidor no ar — não persiste no banco (é pensado pra uso
   ad hoc, imprime no stdout e sai com código ≠ 0 se achar CRITICAL/HIGH, útil pra script/CI futuro).
3. **Agendamento opcional** (`lib/auditScheduler.js`): `FORJA_AUDIT_SCHEDULE_HOURS` — 0/ausente
   (default) desliga completamente; um valor > 0 liga um `setInterval` in-process que roda
   `target='self'` periodicamente, persiste e transmite via WebSocket (reusando
   `orchestrator.broadcast`, o mesmo canal do pipeline — é só um evento genérico, não tem relação
   com `currentTask`). Deliberadamente opt-in: nunca liga sozinho, roda ferramenta externa pesada
   só se o operador pedir explicitamente.

## Consequências

- **Verificado ao vivo, não só testado com mock** — `npm run audit:self` rodou de verdade contra o
  próprio ForjaIA, com AMBAS as ferramentas realmente instaladas (não só o caminho de degradação
  graciosa testado com mock).
- **Semgrep instalado e rodado de verdade** (`brew install semgrep`, a pedido do usuário) — achou 4
  findings HIGH reais na primeira execução, todos da mesma regra
  (`javascript.lang.security.detect-child-process.detect-child-process`, coarse: flag qualquer
  `child_process` alcançável a partir de um argumento de função, sem taint-tracing profundo).
  Investigação individual de cada um:
  - `lib/deployRuntime.js` (`assertHostPortFree`) — `hostPort` sempre chega como `Number(...)`
    coagido em `config.js` (`deployHostPort`/`stagingHostPort`, de env var), nunca string bruta.
    Não injetável.
  - `lib/deployRuntime.js` (`startDeploy`, o `spawn()` do ADR-020) e `sandbox/runner.js`
    (`startChildProcess`) — ambos usam `spawn(cmd, argsArray, opts)` SEM `shell: true`; args em
    array não passam por interpretação de shell, então metacaractere não é explorável dessa forma.
    O risco real que sobra (rodar o `npm start`/`npm install` do próprio projeto gerado) é o
    fallback deliberado de `FORJA_REQUIRE_DOCKER=false` — arquitetura já documentada (ADR-006/018),
    não uma vulnerabilidade nova.
  - `lib/dockerBuild.js` (`execAsync`) — este SIM interpola `cmd` com `shell: true` de verdade; é o
    sink genérico compartilhado. Já tinha cada chamador relevante auditado individualmente no
    ADR-019 (`mobileDeploy.js` sanitiza nome de workspace/scheme; `windowsDeploy.js` só usa
    constante + id numérico).

  Nenhum dos 4 é uma vulnerabilidade nova e não tratada — mas nenhum estava documentado como "já
  revisado" de um jeito que uma ferramenta (ou uma pessoa nova) pudesse confirmar sem reconstruir
  esse raciocínio do zero. Corrigido: cada linha ganhou um comentário `// nosemgrep: <regra> ` com a
  justificativa específica (não um `nosemgrep` cego) — re-rodar `semgrep --config=p/security-audit`
  contra o repo inteiro agora dá **zero achados**, confirmado via `npm run audit:self` de verdade
  depois da mudança. Isso também significa que uma quinta chamada nova e genuinamente arriscada a
  `child_process` (ex.: um caminho novo que interpole dado externo com `shell: true` sem sanitizar)
  vai aparecer limpa numa auditoria futura, sem se afogar em ruído dos 4 já triados.
- `npm run audit:self` também confirmou `npm audit` real com zero vulnerabilidade conhecida nos
  três diretórios (raiz/backend/frontend) — cross-checado rodando `npm audit --json` manualmente em
  cada um, batendo com o resultado do CLI.
- 17 testes novos (`independentAudit.test.js`, `independentAuditHttp.test.js`,
  `auditScheduler.test.js`) cobrindo: detecção de Semgrep ausente, o achado real do exit-code do
  `npm audit`, os três workspaces auditados separadamente em `target='self'`, persistência
  (`create`/`complete`/`fail`/`list`), autenticação da rota, guard de traversal em
  `target='project'`, e o agendador (desligado por padrão, dispara no intervalo configurado,
  chamar `startAuditScheduler` duas vezes não duplica o timer — achado real de um bug de
  isolamento no PRÓPRIO teste, corrigido antes de commitar). Suíte completa do backend: 236/236.
- Nenhuma mudança no pipeline de agentes existente — `agent/security.js`/`lib/secretScan.js`
  continuam exatamente como estavam; esta é uma capacidade nova e paralela, não uma substituição.
