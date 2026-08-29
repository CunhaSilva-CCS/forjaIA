const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

process.env.FORJA_API_TOKEN = 'browser-check-test-token-24char';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-browser-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-browser-${Date.now()}.db`);

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('runBrowserCheck — playwright indisponível degrada graciosamente', () => {
  it('não bloqueia o teste humano quando playwright não está instalado', async () => {
    const playwrightPath = require.resolve('playwright');
    const original = require.cache[playwrightPath];
    delete require.cache[playwrightPath];
    const Module = require('module');
    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === 'playwright') {
        const err = new Error("Cannot find module 'playwright'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      return originalResolve.call(this, request, ...rest);
    };
    try {
      const { runBrowserCheck } = fresh('../lib/browserCheck');
      const result = await runBrowserCheck({ deployUrl: 'http://127.0.0.1:1', buttons: [], runConfig: {}, orchestrator: { log: () => {} } });
      assert.equal(result.available, false);
      assert.equal(result.ok, true);
      assert.match(result.skippedReason, /playwright não está instalado/);
    } finally {
      Module._resolveFilename = originalResolve;
      if (original) require.cache[playwrightPath] = original;
    }
  });
});

describe('runBrowserCheck — achado real: navegador de verdade contra um servidor real', () => {
  let server;
  let baseUrl;

  after(async () => {
    await new Promise((resolve) => server?.close(() => resolve()));
  });

  it('detecta página em branco, clica em botão real e tira screenshot de verdade', async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/blank') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end('<html><head><title>Vazio</title></head><body></body></html>');
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<html><head><title>Demo</title></head><body><h1>Bem-vindo</h1><button onclick="document.getElementById(\'r\').textContent=\'clicado\'">Começar</button><div id="r"></div></body></html>'
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;

    const { runBrowserCheck } = fresh('../lib/browserCheck');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-browser-project-'));

    const result = await runBrowserCheck({
      deployUrl: baseUrl,
      buttons: ['Começar'],
      runConfig: { targetPath: workDir },
      orchestrator: { log: () => {} }
    });

    assert.equal(result.available, true);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.title, 'Demo');
    assert.equal(result.clickedButton, 'Começar');
    assert.equal(result.screenshots.length, 2);
    for (const shot of result.screenshots) {
      assert.ok(fs.existsSync(shot), `screenshot não existe de verdade: ${shot}`);
      assert.ok(fs.statSync(shot).size > 0, `screenshot vazio: ${shot}`);
    }
  });

  it('achado real: página em branco vira um achado CRITICAL de verdade (não só heurística)', async () => {
    const { runBrowserCheck } = fresh('../lib/browserCheck');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-browser-blank-'));

    const result = await runBrowserCheck({
      deployUrl: `${baseUrl}/blank`,
      buttons: [],
      runConfig: { targetPath: workDir },
      orchestrator: { log: () => {} }
    });

    assert.equal(result.available, true);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.id === 'UX-BLANK-PAGE' && i.severity === 'CRITICAL'));
  });
});
