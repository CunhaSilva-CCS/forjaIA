const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'purge-test-token-with-24-chars-x';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-purge-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-purge-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3092';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('run_file_versions purge', () => {
  it('mantém só as N versões mais recentes por (run, path)', () => {
    const { runs } = fresh('../lib/db');
    const row = runs.create({ prompt: 'purge me', config: {} });

    for (let v = 1; v <= 40; v += 1) {
      runs.saveFileVersion(row.id, 'src/a.js', `conteudo v${v}`, v);
    }

    const versions = runs.listFileVersions(row.id, 'src/a.js');
    assert.equal(versions.length, 25);
    assert.equal(versions[0].version, 16); // 40 - 25 + 1
    assert.equal(versions[versions.length - 1].version, 40);
  });

  it('caminhos diferentes têm limites independentes', () => {
    const { runs } = fresh('../lib/db');
    const row = runs.create({ prompt: 'purge me 2', config: {} });

    for (let v = 1; v <= 30; v += 1) {
      runs.saveFileVersion(row.id, 'a.js', `a v${v}`, v);
    }
    runs.saveFileVersion(row.id, 'b.js', 'b v1', 1);

    assert.equal(runs.listFileVersions(row.id, 'a.js').length, 25);
    assert.equal(runs.listFileVersions(row.id, 'b.js').length, 1);
  });
});
