const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'dogfood-status-test-token-24ch';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dogfood-status-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-dogfood-status-${Date.now()}.db`);

const { getDogfoodStatus, __test__ } = require('../lib/dogfoodStatus');
const { readSchedule, readLastRun } = __test__;

describe('dogfoodStatus.readSchedule', () => {
  it('scheduled:true quando o crontab tem uma linha com dogfood-forge.js', () => {
    const result = readSchedule(
      () => 'PATH=/usr/local/bin\n0 6 * * 1 cd /x && npm run dogfood-forge.js >> log 2>&1\n'
    );
    assert.equal(result.scheduled, true);
    assert.match(result.cronLine, /dogfood-forge\.js/);
  });

  it('achado real: também reconhece a linha exata instalada pelo ADR-035 ("npm run dogfood", não o caminho do script)', () => {
    const result = readSchedule(
      () =>
        'PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\n0 6 * * 1 cd /x && npm run service:start >> log 2>&1 && npm run dogfood >> log 2>&1\n'
    );
    assert.equal(result.scheduled, true);
    assert.match(result.cronLine, /npm run dogfood/);
  });

  it('scheduled:false quando o crontab existe mas não tem a linha', () => {
    const result = readSchedule(() => 'PATH=/usr/local/bin\n0 3 * * * node scripts/backup-db.js\n');
    assert.equal(result.scheduled, false);
    assert.equal(result.cronLine, null);
  });

  it('ignora linha comentada (crontab desativado manualmente com #)', () => {
    const result = readSchedule(() => '# 0 6 * * 1 node scripts/dogfood-forge.js\n');
    assert.equal(result.scheduled, false);
  });

  it('scheduled:false (sem lançar erro) quando `crontab -l` falha — ex.: sem crontab configurado', () => {
    const result = readSchedule(() => {
      throw new Error('no crontab for user');
    });
    assert.equal(result.scheduled, false);
    assert.equal(result.cronLine, null);
  });
});

describe('dogfoodStatus.readLastRun', () => {
  it('null quando o diretório de relatórios não existe ainda', () => {
    const dir = path.join(os.tmpdir(), `forja-dogfood-none-${Date.now()}`);
    assert.equal(readLastRun(dir), null);
  });

  it('pega o relatório mais recente (ordenação lexicográfica = cronológica, mesmo padrão do dbBackup)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dogfood-reports-'));
    fs.writeFileSync(
      path.join(dir, '2026-01-01T00-00-00-000Z.json'),
      JSON.stringify({ finishedAt: '2026-01-01', outcome: 'failed', tests: { passed: 2, total: 5 } })
    );
    fs.writeFileSync(
      path.join(dir, '2026-02-01T00-00-00-000Z.json'),
      JSON.stringify({ finishedAt: '2026-02-01', outcome: 'completed', runId: 'run-2', tests: { passed: 5, total: 5 } })
    );
    const result = readLastRun(dir);
    assert.equal(result.outcome, 'completed');
    assert.equal(result.runId, 'run-2');
    assert.equal(result.testsPassed, 5);
    assert.equal(result.testsTotal, 5);
  });

  it('achado real: relatório corrompido/ilegível não derruba a checagem — só volta null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dogfood-corrupt-'));
    fs.writeFileSync(path.join(dir, '2026-01-01T00-00-00-000Z.json'), '{ isso não é json');
    assert.equal(readLastRun(dir), null);
  });
});

describe('dogfoodStatus.getDogfoodStatus', () => {
  it('junta agendamento e última run num único objeto', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dogfood-combined-'));
    fs.writeFileSync(
      path.join(dir, '2026-03-01T00-00-00-000Z.json'),
      JSON.stringify({ finishedAt: '2026-03-01', outcome: 'completed', tests: { passed: 3, total: 3 } })
    );
    const result = getDogfoodStatus({
      readCrontab: () => '0 6 * * 1 node scripts/dogfood-forge.js\n',
      reportDir: dir
    });
    assert.equal(result.scheduled, true);
    assert.equal(result.lastRun.outcome, 'completed');
  });
});
