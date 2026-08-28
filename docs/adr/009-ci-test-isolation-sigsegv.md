# ADR-009 — CI no Node 22 (compatível com better-sqlite3 ≥13) + isolamento de DB por arquivo de teste

**Status:** Aceito

## Contexto

Todo run de CI (`gh run list`) falhava — incluindo runs anteriores a qualquer mudança desta sessão,
remontando ao primeiro commit do repositório. A causa aparente variava a cada run: um arquivo de
teste diferente crashava com `signal: 'SIGSEGV'` (`production.test.js` num run antigo;
`claudeCache.test.js` + `controlPlane.test.js` juntos num run mais recente). Nenhum desses crashes
reproduzia localmente, mesmo rodando a suíte inteira ou o arquivo isolado repetidas vezes.

**Causa raiz real**: `better-sqlite3@13.0.3` (dependência de `backend/lib/db.js`) declara
`"engines": { "node": ">=22" }` no seu `package.json`. O workflow fixava `node-version: '20'` em
`actions/setup-node@v4`. `npm ci` não bloqueia por mismatch de `engines` por padrão — instala
silenciosamente mesmo assim — mas o binário nativo do addon, compilado para a N-API esperada pelo
Node ≥22, crasha com `SIGSEGV` ao ser carregado/usado sob Node 20. Isso explica cada sintoma
observado:
- Só arquivos que efetivamente abrem o banco (`new Database(...)` via `lib/db.js`) crasham — nunca
  os que não tocam nele (`dockerBuild.test.js`, `envScan.test.js`, etc.).
- Nunca reproduz localmente: a máquina de desenvolvimento roda Node 24 (`node --version`), acima do
  mínimo exigido — o binário nativo carrega normalmente.
- É determinístico por natureza (incompatibilidade de ABI), não uma corrida — por isso "qual
  arquivo crasha" parecia variar: depende só de qual arquivo, entre os que tocam o banco, roda
  primeiro/é o único naquele run, não de uma disputa por recurso.
- É pré-existente: a dependência já exigia Node ≥22 antes de qualquer commit desta sessão.

O aviso de depreciação Node 20→24 visível nos logs do CI é um *red herring* — refere-se ao runtime
interno usado para executar as próprias Actions (`checkout@v4`, `setup-node@v4`), não ao
`node-version` usado para instalar dependências e rodar `npm test`.

Uma primeira hipótese (concorrência entre processos de teste escrevendo no mesmo arquivo SQLite
fixo) foi investigada e parcialmente corrigida antes desta causa raiz ser confirmada — 7 dos 13
arquivos de teste não isolavam `FORJA_DB_PATH` e caíam no caminho fixo default. Essa lacuna era
real e vale manter corrigida como higiene de teste (evita comportamento não-determinístico entre
arquivos), mas **não era** a causa do SIGSEGV: o crash acontecia mesmo com um único arquivo rodando
sozinho, sem nenhuma concorrência (confirmado num run com `--test-concurrency=1` já aplicado, onde
só `claudeCache.test.js` — que toca o banco — continuou falhando).

## Decisão

1. **Correção da causa raiz**: `.github/workflows/ci.yml` sobe `node-version` de `'20'` para
   `'22'`, satisfazendo o `engines` de `better-sqlite3@13.0.3`.
2. **Isolamento por arquivo** (higiene de teste, mantido): os 7 arquivos de teste que não definiam
   `FORJA_DB_PATH` (`claudeCache`, `chaos`, `dockerBuild`, `envScan`, `dockerChaos`,
   `healerFileSelection`, `llmCursor`) passam a gerar um caminho único em `os.tmpdir()` no topo do
   arquivo, seguindo o padrão já usado nos outros 6 (`controlPlane`, `httpIntegration`,
   `phase1Squad`, `fileVersionsPurge`, `production`, `orchestratorStages`) — evita que testes
   futuros compartilhem estado de banco por acidente.
3. **Concorrência serializada no CI** (mantida como cinto de segurança): `backend/package.json`'s
   `test` script inclui `--test-concurrency=1`. Não foi a correção do SIGSEGV, mas remove uma
   classe de race condition (múltiplos processos tocando o mesmo recurso por falta de isolamento
   futuro) que continuaria sendo um risco mesmo depois do fix de versão do Node.

## Consequências

- CI passa a exigir Node ≥22 para instalar/rodar; qualquer dependência nova deve ser checada contra
  essa versão mínima.
- CI fica um pouco mais lento (execução de teste serializada em vez de paralela) — aceitável frente
  ao custo de builds vermelhas intermitentes e difíceis de diagnosticar.
- Qualquer novo arquivo de teste que precise de estado real (DB, porta) deve seguir o padrão
  `FORJA_DB_PATH`/`FORJA_WORKSPACE_ROOT`/`PORT` únicos por arquivo — isolamento por padrão, não por
  exceção.
