const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');
const childProcess = require('child_process');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-windows-${Date.now()}.db`);
process.env.FORJA_WINDOWS_REGISTER_DELAY_MS = '5';
process.env.FORJA_WINDOWS_POLL_MS = '5';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

function mockSpawnSequence(responses) {
  let call = 0;
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    process.nextTick(() => {
      if (response.stdout) child.stdout.emit('data', Buffer.from(response.stdout));
      child.emit('close', response.code ?? 0);
    });
    return child;
  };
}

describe('supportsWindows (ADR-018)', () => {
  it('true só quando windows/ E o workflow existem', () => {
    const { supportsWindows, WORKFLOW_FILE } = fresh('../lib/windowsDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-win-ok-'));
    fs.mkdirSync(path.join(dir, 'windows'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', WORKFLOW_FILE), 'name: x');
    assert.equal(supportsWindows(dir), true);
  });

  it('false com só a pasta windows/, sem o workflow', () => {
    const { supportsWindows } = fresh('../lib/windowsDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-win-partial-'));
    fs.mkdirSync(path.join(dir, 'windows'), { recursive: true });
    assert.equal(supportsWindows(dir), false);
  });

  it('false num projeto que não tem nada disso', () => {
    const { supportsWindows } = fresh('../lib/windowsDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-win-none-'));
    assert.equal(supportsWindows(dir), false);
  });
});

describe('triggerWindowsBuild (ADR-018)', () => {
  const originalSpawn = childProcess.spawn;

  function setupProject() {
    const { WORKFLOW_FILE } = fresh('../lib/windowsDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-win-trigger-'));
    fs.mkdirSync(path.join(dir, 'windows'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', WORKFLOW_FILE), 'name: x');
    return dir;
  }

  it('rejeita antes de tentar gh se o projeto não tem suporte Windows configurado', async () => {
    const { triggerWindowsBuild } = fresh('../lib/windowsDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-win-unsupported-'));
    const orchestrator = { log: () => {} };
    await assert.rejects(
      triggerWindowsBuild({ projectDir: dir, orchestrator }),
      /sem suporte a Windows configurado/
    );
  });

  it('achado real: disparo bem-sucedido acompanha o run até completed/success', async () => {
    const dir = setupProject();
    mockSpawnSequence([
      { stdout: '', code: 0 }, // gh workflow run
      { stdout: JSON.stringify([{ databaseId: 999, status: 'in_progress', url: '' }]), code: 0 }, // gh run list
      { stdout: JSON.stringify({ status: 'completed', conclusion: 'success', url: 'https://github.com/x/actions/runs/999' }), code: 0 } // gh run view
    ]);
    try {
      fresh('../lib/dockerBuild');
      const { triggerWindowsBuild } = fresh('../lib/windowsDeploy');
      const logs = [];
      const orchestrator = { log: (agent, msg) => logs.push(msg) };
      const result = await triggerWindowsBuild({ projectDir: dir, orchestrator });
      assert.equal(result.type, 'windows-ci');
      assert.equal(result.runId, 999);
      assert.ok(logs.some((m) => /concluído com sucesso/.test(m)));
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('achado real: run completed com falha rejeita com o link do run', async () => {
    const dir = setupProject();
    mockSpawnSequence([
      { stdout: '', code: 0 },
      { stdout: JSON.stringify([{ databaseId: 1000, status: 'queued', url: '' }]), code: 0 },
      { stdout: JSON.stringify({ status: 'completed', conclusion: 'failure', url: 'https://github.com/x/actions/runs/1000' }), code: 0 }
    ]);
    try {
      fresh('../lib/dockerBuild');
      const { triggerWindowsBuild } = fresh('../lib/windowsDeploy');
      const orchestrator = { log: () => {} };
      await assert.rejects(triggerWindowsBuild({ projectDir: dir, orchestrator }), /falhou no GitHub Actions/);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });
});
