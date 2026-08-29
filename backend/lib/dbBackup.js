/**
 * Backup do SQLite (ver ADR-032) — todo o histórico de runs, versões de arquivo e dados de
 * equipe vive num único arquivo `.db` sem estratégia de backup até este ADR. Usa a Online Backup
 * API do SQLite via better-sqlite3's `db.backup()` — segura mesmo com o servidor rodando e
 * escrevendo (modo WAL já ativo em lib/db.js), diferente de uma cópia de arquivo simples, que
 * pode capturar um estado inconsistente no meio de uma transação.
 */
const fs = require('fs');
const path = require('path');

/** Nome do arquivo de backup: mesmo prefixo do original + timestamp ISO sem caracteres
 * problemáticos pra nome de arquivo, pra ordenar cronologicamente com um `ls` simples. */
function backupFilename(sourcePath) {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base}-${stamp}.db`;
}

/**
 * Faz o backup de verdade (Online Backup API — segura sob escrita concorrente) e devolve o
 * caminho do arquivo gerado. `destDir` é criado se não existir. `getDb`/`sourcePath` são
 * injetáveis (default: os reais de lib/db.js e lib/config.js) só pra facilitar teste.
 */
async function backupDatabase({
  getDb = require('./db').getDb,
  sourcePath = require('./config').dbPath,
  destDir = require('./config').backupDir
} = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, backupFilename(sourcePath));
  const db = getDb();
  await db.backup(destPath);
  return destPath;
}

/**
 * Mantém só os `keep` backups mais recentes (por nome — já ordenável cronologicamente pelo
 * timestamp no nome) — sem isso, um backup automático rodando com frequência (cron) acumula
 * disco indefinidamente.
 */
function pruneOldBackups(destDir, keep = 14) {
  if (!fs.existsSync(destDir)) return [];
  const files = fs
    .readdirSync(destDir)
    .filter((f) => f.endsWith('.db'))
    .sort(); // timestamp no nome ordena cronologicamente
  const toRemove = files.slice(0, Math.max(0, files.length - keep));
  for (const f of toRemove) {
    fs.rmSync(path.join(destDir, f), { force: true });
  }
  return toRemove;
}

module.exports = { backupDatabase, pruneOldBackups, backupFilename };
