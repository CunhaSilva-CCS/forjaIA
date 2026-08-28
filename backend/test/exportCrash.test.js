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

/**
 * Achado real (zip-slip defensivo): `file.path` vem direto do banco (run.files, gerado pelo
 * LLM) sem a mesma checagem de traversal que devops.js aplica ao escrever em disco. Sem
 * sanitização, um path como "../../../etc/cron.d/x" viraria o nome de uma entrada do zip —
 * quem extrai esse download com uma ferramenta ingênua escreveria fora do diretório de destino.
 */
describe('streamRunExport — sanitiza path de traversal nas entradas do zip (achado real)', () => {
  it('ignora arquivo com path tentando escapar do diretório code/, mantém os demais', async () => {
    const archiverPath = require.resolve('archiver');
    const originalEntry = require.cache[archiverPath];

    const appended = [];
    const fakeArchive = new EventEmitter();
    fakeArchive.pipe = () => {};
    fakeArchive.append = (content, opts) => {
      appended.push(opts.name);
    };
    fakeArchive.abort = () => {};
    fakeArchive.finalize = () => {
      process.nextTick(() => fakeArchive.emit('end'));
    };

    require.cache[archiverPath] = {
      id: archiverPath,
      filename: archiverPath,
      loaded: true,
      exports: () => fakeArchive
    };

    const db = fresh('../lib/db');
    const run = db.runs.create({ prompt: 'zip slip test' });
    db.runs.update(run.id, {
      files: [
        { path: 'src/index.js', content: 'ok' },
        { path: '../../../etc/cron.d/malicioso', content: 'evil' },
        { path: '/etc/passwd', content: 'evil-absolute' }
      ]
    });

    const { streamRunExport } = fresh('../lib/export');
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.destroy = () => {};

    try {
      await streamRunExport(run.id, res);
      assert.ok(appended.includes('code/src/index.js'), 'arquivo legítimo deveria estar no zip');
      assert.ok(
        !appended.some((n) => n.includes('..') || n.includes('/etc/')),
        `entrada de path suspeito vazou pro zip: ${JSON.stringify(appended)}`
      );
    } finally {
      if (originalEntry) {
        require.cache[archiverPath] = originalEntry;
      } else {
        delete require.cache[archiverPath];
      }
    }
  });
});
