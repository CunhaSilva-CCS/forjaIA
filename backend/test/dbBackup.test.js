const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-dbbackup-${Date.now()}.db`);

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('dbBackup.backupDatabase (ADR-032, achado real: sem estratégia de backup até este ADR)', () => {
  it('achado real: o arquivo de backup é um SQLite de verdade, restaurável, com os dados reais', async () => {
    const { backupDatabase } = fresh('../lib/dbBackup');

    const sourcePath = path.join(os.tmpdir(), `forja-dbbackup-source-${Date.now()}.db`);
    const source = new Database(sourcePath);
    source.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, prompt TEXT)');
    source.prepare('INSERT INTO runs VALUES (?, ?)').run('run-1', 'construa uma API de teste');

    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dbbackup-dest-'));
    const destPath = await backupDatabase({ getDb: () => source, sourcePath, destDir });

    assert.ok(fs.existsSync(destPath));
    assert.ok(fs.statSync(destPath).size > 0);

    // Achado real: não basta o arquivo existir — abre de verdade e lê os dados de volta, provando
    // que é um backup íntegro e restaurável, não só bytes copiados.
    const restored = new Database(destPath, { readonly: true });
    const row = restored.prepare('SELECT * FROM runs WHERE id = ?').get('run-1');
    assert.equal(row.prompt, 'construa uma API de teste');

    source.close();
    restored.close();
  });

  it('o nome do arquivo de backup ordena cronologicamente e some no diretório certo', async () => {
    const { backupDatabase } = fresh('../lib/dbBackup');
    const sourcePath = path.join(os.tmpdir(), `forja-dbbackup-source2-${Date.now()}.db`);
    const source = new Database(sourcePath);
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dbbackup-dest2-'));

    const destPath = await backupDatabase({ getDb: () => source, sourcePath, destDir });
    assert.equal(path.dirname(destPath), destDir);
    assert.match(path.basename(destPath), /^forja-dbbackup-source2-\d+-\d{4}-\d{2}-\d{2}T.*\.db$/);
    source.close();
  });
});

describe('dbBackup.pruneOldBackups', () => {
  it('mantém só os N mais recentes, remove o resto', () => {
    const { pruneOldBackups } = fresh('../lib/dbBackup');
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dbbackup-prune-'));
    const names = ['forja-2026-01-01T00-00-00-000Z.db', 'forja-2026-01-02T00-00-00-000Z.db', 'forja-2026-01-03T00-00-00-000Z.db'];
    for (const n of names) fs.writeFileSync(path.join(destDir, n), 'x');

    const removed = pruneOldBackups(destDir, 2);
    assert.deepEqual(removed, [names[0]]);
    assert.deepEqual(fs.readdirSync(destDir).sort(), [names[1], names[2]]);
  });

  it('não quebra num diretório vazio ou inexistente', () => {
    const { pruneOldBackups } = fresh('../lib/dbBackup');
    assert.deepEqual(pruneOldBackups('/tmp/forja-nao-existe-de-verdade-xyz', 5), []);
  });

  it('keep >= quantidade de arquivos não remove nada', () => {
    const { pruneOldBackups } = fresh('../lib/dbBackup');
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dbbackup-prune2-'));
    fs.writeFileSync(path.join(destDir, 'forja-a.db'), 'x');
    const removed = pruneOldBackups(destDir, 10);
    assert.deepEqual(removed, []);
  });
});
