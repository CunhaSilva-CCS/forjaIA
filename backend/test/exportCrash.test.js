const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

process.env.FORJA_API_TOKEN = 'export-crash-test-token-24char';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-exp-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-exp-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3097';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

/**
 * Antes desta correção, `archive.on('error', err => { throw err })` derrubava o processo Node
 * inteiro num erro real de stream (cliente fecha a conexão no meio do download) — sem
 * `uncaughtException` handler em lugar nenhum, isso mataria toda run em andamento, não só o
 * download. Este teste prova que um erro do archiver não escapa mais como exceção não tratada:
 * se a correção regredisse, `archive.on('error', err => { throw err })` faria essa asserção
 * `await` nunca resolver (ou o próprio runner de teste crasharia com um uncaughtException).
 */
describe('streamRunExport — erro do archiver não derruba o processo (achado real)', () => {
  it('resolve normalmente e encerra a resposta, em vez de lançar exceção não tratada', async () => {
    const archiverPath = require.resolve('archiver');
    const originalEntry = require.cache[archiverPath];

    const fakeArchive = new EventEmitter();
    fakeArchive.pipe = () => {};
    fakeArchive.append = () => {};
    fakeArchive.abort = () => {};
    fakeArchive.finalize = () => {
      process.nextTick(() => fakeArchive.emit('error', new Error('boom simulado (conexão caiu)')));
    };

    require.cache[archiverPath] = {
      id: archiverPath,
      filename: archiverPath,
      loaded: true,
      exports: () => fakeArchive
    };

    const db = fresh('../lib/db');
    const run = db.runs.create({ prompt: 'export crash test' });

    const { streamRunExport } = fresh('../lib/export');

    const res = new EventEmitter();
    res.headersSent = true; // simula que o download já começou a ser escrito
    res.writableEnded = false;
    let destroyed = false;
    res.setHeader = () => {};
    res.destroy = () => {
      destroyed = true;
    };

    try {
      // Se o bug voltar (`throw` dentro do listener), isso vira uma exceção não tratada no
      // processo do test runner, não uma rejeição desta Promise — o teste falharia derrubando
      // toda a suíte, não com um assert.rejects comum.
      await streamRunExport(run.id, res);
      assert.equal(destroyed, true, 'esperava que a resposta fosse destruída após o erro');
    } finally {
      if (originalEntry) {
        require.cache[archiverPath] = originalEntry;
      } else {
        delete require.cache[archiverPath];
      }
    }
  });
});
