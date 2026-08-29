#!/usr/bin/env node
/**
 * Backup do SQLite do ForjaIA (ver ADR-032). Uso:
 *   node scripts/backup-db.js
 *   node scripts/backup-db.js --dir /caminho/alternativo/de/backups
 *   node scripts/backup-db.js --keep 30
 *
 * Pra automatizar (cron, ex. diário às 3h):
 *   0 3 * * * cd /caminho/do/ForjaIA && node scripts/backup-db.js >> data/backup.log 2>&1
 *
 * Restaurar: pare o serviço do ForjaIA, troque data/forja.db pelo arquivo de backup escolhido
 * (mesmo nome, `forja.db`), suba o serviço de novo. Ver docs/adr/032-database-backup.md.
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

function parseArgs(argv) {
  const args = { dir: null, keep: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--keep') args.keep = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { backupDatabase, pruneOldBackups } = require('../backend/lib/dbBackup');
  const config = require('../backend/lib/config');

  const destDir = args.dir || config.backupDir;
  const keep = Number.isFinite(args.keep) ? args.keep : config.backupRetentionCount;

  const destPath = await backupDatabase({ destDir });
  console.log(`Backup criado: ${destPath}`);

  const removed = pruneOldBackups(destDir, keep);
  if (removed.length) {
    console.log(`Backups antigos removidos (mantendo os ${keep} mais recentes): ${removed.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Falha ao fazer backup:', err.message);
  process.exit(1);
});
