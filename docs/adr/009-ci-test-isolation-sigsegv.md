# ADR-009 — Isolamento de DB por arquivo de teste + concorrência serializada no CI

**Status:** Aceito

## Contexto

Todo run de CI (`gh run list`) falhava — incluindo runs anteriores a qualquer mudança desta sessão,
remontando ao primeiro commit do repositório. A causa aparente variava a cada run: um arquivo de
teste diferente crashava com `signal: 'SIGSEGV'` (`production.test.js`, depois `claudeCache.test.js`
e `controlPlane.test.js` juntos no mesmo run). Nenhum desses crashes reproduzia localmente, mesmo
rodando a suíte inteira ou o arquivo isolado repetidas vezes.

Investigação (`gh run view --log-failed` em dois runs distintos, mais leitura de
`backend/lib/config.js` e de todos os `backend/test/*.test.js`) encontrou a causa raiz:

- `backend/lib/config.js` resolve `dbPath` para um caminho fixo (`data/forja.db`) sempre que
  `FORJA_DB_PATH` não está definido no ambiente.
- `node --test test/*.test.js` roda cada arquivo de teste em processo separado, **em paralelo**,
  por padrão (`--test-concurrency` = nº de CPUs do runner).
- 7 dos 13 arquivos de teste não definiam `FORJA_DB_PATH`, então todos caíam no mesmo arquivo
  SQLite fixo. Múltiplos processos do runner da GitHub Actions abrindo/escrevendo o mesmo arquivo
  `better-sqlite3` (módulo nativo) ao mesmo tempo é uma condição de corrida clássica para corrupção
  de memória nativa — que se manifesta como `SIGSEGV`, não como uma exceção JS capturável.

Isso explica todos os sintomas observados: qual arquivo falha varia (depende de qual dupla de
processos colide no timing exato), não reproduz localmente (a corrida depende da concorrência real
de CPU/I/O do runner Linux, diferente da máquina de desenvolvimento), e é pré-existente (a lacuna
estrutural já existia antes de qualquer commit desta sessão — só ganhou mais um arquivo na lista
dos não-isolados).

O aviso de depreciação Node 20→24 visível nos logs do CI é um *red herring*: refere-se ao runtime
interno usado para executar as próprias Actions (`checkout@v4`, `setup-node@v4`), não ao
`node-version: '20'` já fixado em `.github/workflows/ci.yml` para instalar dependências e rodar
`npm test`.

## Decisão

Duas mudanças, complementares:

1. **Isolamento por arquivo** (correção da causa raiz): os 7 arquivos de teste que não definiam
   `FORJA_DB_PATH` (`claudeCache`, `chaos`, `dockerBuild`, `envScan`, `dockerChaos`,
   `healerFileSelection`, `llmCursor`) passam a gerar um caminho único em `os.tmpdir()` no topo do
   arquivo, seguindo o mesmo padrão já usado nos outros 6 (`controlPlane`, `httpIntegration`,
   `phase1Squad`, `fileVersionsPurge`, `production`, `orchestratorStages`).
2. **Concorrência serializada no CI** (mitigação estrutural): `backend/package.json`'s `test` script
   passa a incluir `--test-concurrency=1`. Mesmo com todo arquivo isolado, roda em paralelo
   continua sendo uma superfície de risco (novo arquivo de teste esquecendo o isolamento, ou
   qualquer outro recurso compartilhado por padrão fixo) — serializar no CI custa alguns segundos a
   mais de execução em troca de eliminar essa classe inteira de corrida em produção de CI.

## Consequências

- CI fica um pouco mais lento (execução serializada em vez de paralela) — aceitável frente ao custo
  de builds vermelhas de forma intermitente e não-diagnosticável.
- Localmente `npm test` também passa a rodar serializado (mesmo script) — sem impacto perceptível
  dado o tamanho atual da suíte (105 testes, ~5s).
- Qualquer novo arquivo de teste que precise de estado real (DB, porta) deve seguir o padrão
  `FORJA_DB_PATH`/`FORJA_WORKSPACE_ROOT`/`PORT` únicos por arquivo — isolamento por padrão, não por
  exceção.
