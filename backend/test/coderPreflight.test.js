const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { validatePackageJson, probeHealth } = require('../lib/coderPreflight');

describe('coderPreflight', () => {
  it('validatePackageJson reprova JSON inválido', () => {
    const result = validatePackageJson([{ path: 'package.json', content: '{ invalid' }]);
    assert.equal(result.passed, false);
  });

  it('validatePackageJson aprova JSON válido', () => {
    const result = validatePackageJson([
      { path: 'package.json', content: JSON.stringify({ name: 'app', scripts: { start: 'node index.js' } }) }
    ]);
    assert.equal(result.passed, true);
  });

  it('probeHealth encontra rota respondendo', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const health = await probeHealth(`http://127.0.0.1:${port}`);
      assert.equal(health.passed, true);
      assert.equal(health.probe, '/health');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
