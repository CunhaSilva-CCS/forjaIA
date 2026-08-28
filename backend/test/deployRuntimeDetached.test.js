const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');
const { EventEmitter } = require('events');

process.env.FORJA_API_TOKEN = 'deploy-runtime-detached-test-token';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-deployrt-ws-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-deployrt-${Date.now()}.db`);

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

/**
 * Achado real (pente fino, ADR-019/020): o caminho de deploy sem Docker (FORJA_REQUIRE_DOCKER=false)
 * spawnava o processo do app com stdio ligado por pipe ao processo do ForjaIA — o mesmo bug que o
 * ADR-014 documentou e corrigiu pro Metro do `expo run:ios`. Um reinício do ForjaIA (comum em
 * desenvolvimento) quebrava o pipe e derrubava o app deployado junto. Este teste prova que o spawn
 * agora usa `detached: true` com stdio redirecionado pra um arquivo real, não um pipe.
 */
describe('deployRuntime startDeploy (fallback sem Docker) — detached + stdio em arquivo', () => {
  it('spawna com detached:true e stdio como file descriptors, não pipe', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-deployrt-fixture-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { start: 'node server.js' } })
    );
    fs.writeFileSync(
      path.join(dir, 'server.js'),
      "require('http').createServer((req,res)=>res.end('ok')).listen(process.env.PORT);"
    );

    const originalSpawn = childProcess.spawn;
    let capturedOptions = null;
    childProcess.spawn = (cmd, args, options) => {
      capturedOptions = options;
      const fake = new EventEmitter();
      fake.pid = 999999;
      fake.unref = () => {};
      return fake;
    };
    // dockerBuild.js também destructura spawn no topo — precisa re-requerer as duas.
    const dockerBuild = fresh('../lib/dockerBuild');
    const originalExecAsync = dockerBuild.execAsync;
    dockerBuild.execAsync = async () => ({ stdout: '', stderr: '' });

    try {
      const deployRuntime = fresh('../lib/deployRuntime');
      const orchestrator = { log: () => {}, throwIfAborted: () => {} };
      const resultPromise = deployRuntime.startDeploy({
        deployDir: dir,
        hostPort: 39231,
        env: {},
        orchestrator
      });
      resultPromise.catch(() => undefined); // não nos importa o resultado final, só a chamada de spawn

      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.ok(capturedOptions, 'spawn não foi chamado');
      assert.equal(capturedOptions.detached, true);
      assert.ok(Array.isArray(capturedOptions.stdio), 'stdio deveria ser um array de fds, não "pipe"');
      assert.equal(capturedOptions.stdio[0], 'ignore');
      assert.equal(typeof capturedOptions.stdio[1], 'number');
      assert.equal(capturedOptions.stdio[1], capturedOptions.stdio[2]);
    } finally {
      childProcess.spawn = originalSpawn;
      dockerBuild.execAsync = originalExecAsync;
    }
  });
});
