# ADR-032 — Backup do SQLite + procedimento de restore documentado

**Status:** Aceito

## Contexto

Todo o histórico de runs, versões de arquivo curadas, dados de equipe/RBAC, uso de LLM e
auditorias independentes vive num único arquivo SQLite (`backend/data/forja.db`) sem nenhuma
estratégia de backup — um disco corrompido, um `rm` acidental ou um deploy que apaga o volume
errado perde tudo, sem chance de recuperação. Pra um sistema que se propõe "profissional", isso é
uma lacuna de robustez pura: não adiciona feature nenhuma, mas é o tipo de coisa que só dói quando
já é tarde.

## Decisão

**`backend/lib/dbBackup.js`** (novo): `backupDatabase({ destDir })` usa a Online Backup API do
SQLite via `db.backup(destino)` do better-sqlite3 — segura mesmo com o servidor rodando e
escrevendo (modo WAL já ativo em `lib/db.js`), diferente de copiar o arquivo `.db` direto, que
pode capturar um estado inconsistente no meio de uma transação. `pruneOldBackups(dir, keep)` evita
acúmulo indefinido de disco quando o backup roda com frequência (cron).

**`scripts/backup-db.js`** (novo, CLI): `node scripts/backup-db.js` ou `npm run backup:db`. Aceita
`--dir`/`--keep`; pensado pra rodar via cron (exemplo documentado no próprio cabeçalho do script).

**`lib/config.js`**: `backupDir` (default `data/backups/`, override via `FORJA_BACKUP_DIR`) e
`backupRetentionCount` (default 14, override via `FORJA_BACKUP_RETENTION`).

**Procedimento de restore** (documentado aqui — é o que realmente falta quando só existe o backup,
sem instrução de como usar):
1. Pare o serviço do ForjaIA (`npm run service:stop`, ou mate o processo do `server.js`).
2. Escolha o arquivo de backup desejado em `data/backups/` (nome ordena cronologicamente:
   `forja-<timestamp-ISO>.db`).
3. Copie esse arquivo por cima de `data/forja.db` (faça um backup do `forja.db` atual antes, se
   ele ainda tiver dado recente que valha a pena preservar antes de sobrescrever).
4. Suba o serviço de novo (`npm run service:start`). `restorePendingApproval()` (ADR-030) já lida
   com o estado que estava em `awaiting_approval` no momento do backup, do mesmo jeito que lidaria
   com um restart normal.

## Verificação ao vivo

Rodei `npm run backup:db` contra o banco de desenvolvimento real (não um fixture) — gerou um
arquivo de 47MB em `data/backups/`, abri de volta com `better-sqlite3` em modo readonly e conferi:
51 runs reais, todas as 10 tabelas presentes (`runs`, `run_events`, `run_file_versions`,
`team_members`, `llm_usage`, `provider_cooldowns`, `audit_runs`, etc.) — não é só um arquivo do
tamanho certo, é um SQLite genuinamente restaurável com os dados de verdade dentro.

## Consequências

- Backend: 5 testes novos em `dbBackup.test.js`, incluindo um que abre o arquivo de backup de
  volta e lê os dados (não só confere que o arquivo existe/tem tamanho > 0).
- `data/backups/` já cai dentro do `.gitignore` existente (`backend/data/`) — nenhum risco de um
  backup (que pode conter dado sensível de projetos reais) ser commitado por engano.
- Não é backup automático por padrão — precisa configurar o cron (ou equivalente) manualmente;
  documentado no cabeçalho do próprio script. Rodar `npm run backup:db` continua sendo uma ação
  manual até alguém decidir automatizar, o que é a decisão certa: agendamento é responsabilidade
  de operação/infra do ambiente de cada instalação, não algo que o ForjaIA deveria assumir
  silenciosamente sozinho.
- Não cobre backup de arquivos fora do SQLite (ex.: PDFs de relatório em `_reports/`, screenshots
  do teste humano) — decisão deliberada: esses são artefatos regeneráveis a partir de uma run já
  registrada no banco, não dados primários irrecuperáveis como o histórico de runs em si.
