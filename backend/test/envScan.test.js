const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-envscan-${Date.now()}.db`);

const { scanEnvVarNames } = require('../lib/envScan');

describe('scanEnvVarNames', () => {
  it('retorna vazio sem arquivos', () => {
    assert.equal(scanEnvVarNames([]).size, 0);
    assert.equal(scanEnvVarNames(undefined).size, 0);
  });

  it('extrai nomes de process.env.NOME em um arquivo', () => {
    const files = [{ path: 'src/config.ts', content: "const secret = process.env.SESSION_SECRET;" }];
    assert.deepEqual([...scanEnvVarNames(files)], ['SESSION_SECRET']);
  });

  it('deduplica quando o mesmo nome aparece em vários arquivos', () => {
    const files = [
      { path: 'a.ts', content: 'process.env.API_TOKEN' },
      { path: 'b.ts', content: 'if (!process.env.API_TOKEN) throw new Error();' }
    ];
    assert.deepEqual([...scanEnvVarNames(files)], ['API_TOKEN']);
  });

  it('coleta múltiplos nomes distintos em ordem de descoberta', () => {
    const files = [
      { path: 'app.ts', content: 'process.env.PORT; process.env.CORS_ORIGIN;' },
      { path: 'db.ts', content: 'process.env.DATABASE_URL' }
    ];
    assert.deepEqual([...scanEnvVarNames(files)], ['PORT', 'CORS_ORIGIN', 'DATABASE_URL']);
  });

  it('ignora minúsculas e acesso via colchetes/destructuring (limitação conhecida)', () => {
    const files = [{ path: 'x.ts', content: "process.env.lowercase; const { API_KEY } = process.env;" }];
    assert.equal(scanEnvVarNames(files).size, 0);
  });

  it('tolera arquivos sem content ou com path ausente', () => {
    const files = [{ path: 'a.ts' }, { content: 'process.env.FOO' }, null];
    assert.deepEqual([...scanEnvVarNames(files)], ['FOO']);
  });
});
