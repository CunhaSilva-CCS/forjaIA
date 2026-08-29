const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');
const { EventEmitter } = require('events');

process.env.FORJA_API_TOKEN = 'independent-audit-test-token-24c';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-audit-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-audit-${Date.now()}.db`);

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

/** Mocka childProcess.spawn com respostas fixas por comando, casando no início da string. */
function mockSpawn(responses) {
  childProcess.spawn = (cmd, args, opts) => {
    const full = [cmd, ...(Array.isArray(args) ? args : [])].join(' ');
    const match = responses.find((r) => full.startsWith(r.match)) || responses.find((r) => r.match === '*');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => {
      if (match?.stdout) child.stdout.emit('data', Buffer.from(match.stdout));
      if (match?.stderr) child.stderr.emit('data', Buffer.from(match.stderr));
      child.emit('close', match?.code ?? 0);
    });
    return child;
  };
}

describe('checkSemgrepAvailable / resolveSelfTargetDir', () => {
  it('resolveSelfTargetDir aponta pra raiz do repo (contém backend/ e frontend/)', () => {
    const { resolveSelfTargetDir } = fresh('../lib/independentAudit');
    const dir = resolveSelfTargetDir();
    assert.ok(fs.existsSync(path.join(dir, 'backend')));
    assert.ok(fs.existsSync(path.join(dir, 'frontend')));
  });

  it('detecta semgrep ausente sem lançar erro', async () => {
    const originalSpawn = childProcess.spawn;
    mockSpawn([{ match: 'semgrep --version', code: 127 }]); // "command not found"
    try {
      fresh('../lib/dockerBuild');
      const { checkSemgrepAvailable } = fresh('../lib/independentAudit');
      assert.equal(await checkSemgrepAvailable(), false);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });
});

describe('runIndependentAudit — semgrep indisponível cai pro npm audit sozinho', () => {
  it('reporta semgrep como não-disponível e ainda roda npm audit', async () => {
    const originalSpawn = childProcess.spawn;
    const npmAuditJson = JSON.stringify({
      vulnerabilities: {
        lodash: { severity: 'high', range: '<4.17.21', via: ['Prototype Pollution'] }
      }
    });
    mockSpawn([
      { match: 'semgrep --version', code: 127 },
      { match: 'npm audit --json', stdout: npmAuditJson, code: 0 }
    ]);
    try {
      fresh('../lib/dockerBuild');
      const { runIndependentAudit } = fresh('../lib/independentAudit');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-audit-project-'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }));

      const result = await runIndependentAudit({ target: 'project', targetDir: dir });
      assert.equal(result.tools.semgrep.available, false);
      assert.equal(result.tools.npmAudit.available, true);
      assert.ok(result.findings.some((f) => f.id.includes('lodash')));
      assert.match(result.summary, /HIGH/);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('achado real: npm audit sai com código != 0 quando ACHA vulnerabilidade — não é tratado como falha da ferramenta', async () => {
    const originalSpawn = childProcess.spawn;
    const npmAuditJson = JSON.stringify({
      vulnerabilities: { minimist: { severity: 'critical', range: '<1.2.6', via: ['Prototype Pollution'] } }
    });
    mockSpawn([
      { match: 'semgrep --version', code: 127 },
      { match: 'npm audit --json', stdout: npmAuditJson, code: 1 } // achado real: exit 1 com JSON válido
    ]);
    try {
      fresh('../lib/dockerBuild');
      const { runIndependentAudit } = fresh('../lib/independentAudit');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-audit-nonzero-'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }));

      const result = await runIndependentAudit({ target: 'project', targetDir: dir });
      assert.ok(result.findings.some((f) => f.id.includes('minimist')));
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('projeto sem package.json: npm audit não é tentado, sem erro', async () => {
    const originalSpawn = childProcess.spawn;
    mockSpawn([{ match: 'semgrep --version', code: 127 }]);
    try {
      fresh('../lib/dockerBuild');
      const { runIndependentAudit } = fresh('../lib/independentAudit');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-audit-nopkg-'));
      const result = await runIndependentAudit({ target: 'project', targetDir: dir });
      assert.deepEqual(result.tools.npmAudit.findings, []);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('target "self" audita root + backend + frontend separadamente', async () => {
    const originalSpawn = childProcess.spawn;
    let npmAuditCalls = 0;
    childProcess.spawn = (cmd, args, opts) => {
      const full = [cmd, ...(Array.isArray(args) ? args : [])].join(' ');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        if (full.startsWith('semgrep --version')) {
          child.emit('close', 127);
          return;
        }
        if (full.startsWith('npm audit --json')) {
          npmAuditCalls += 1;
          child.stdout.emit('data', Buffer.from(JSON.stringify({ vulnerabilities: {} })));
          child.emit('close', 0);
          return;
        }
        child.emit('close', 0);
      });
      return child;
    };
    try {
      fresh('../lib/dockerBuild');
      const { runIndependentAudit, resolveSelfTargetDir } = fresh('../lib/independentAudit');
      await runIndependentAudit({ target: 'self', targetDir: resolveSelfTargetDir() });
      assert.equal(npmAuditCalls, 3, 'esperava 1 chamada de npm audit por workspace (root/backend/frontend)');
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });
});

describe('auditRuns (persistência)', () => {
  it('create → complete: acha os achados salvos de volta via get()', () => {
    const { auditRuns } = fresh('../lib/independentAudit');
    const row = auditRuns.create({ target: 'self', targetPath: '/tmp/x' });
    assert.equal(row.status, 'running');

    auditRuns.complete(row.id, {
      findings: [{ id: 'F1', severity: 'HIGH', title: 'x', file: 'a.js' }],
      tools: { semgrep: { available: true, findings: [] }, npmAudit: { available: true, findings: [] } },
      summary: '1 achado(s) — 1 HIGH',
      finishedAt: new Date().toISOString()
    });

    const loaded = auditRuns.get(row.id);
    assert.equal(loaded.status, 'completed');
    assert.equal(loaded.findings.length, 1);
    assert.equal(loaded.summary, '1 achado(s) — 1 HIGH');
  });

  it('create → fail: status vira failed com a mensagem de erro', () => {
    const { auditRuns } = fresh('../lib/independentAudit');
    const row = auditRuns.create({ target: 'project', targetPath: '/tmp/y' });
    auditRuns.fail(row.id, new Error('semgrep travou'));
    const loaded = auditRuns.get(row.id);
    assert.equal(loaded.status, 'failed');
    assert.equal(loaded.error, 'semgrep travou');
  });

  it('list() retorna as runs mais recentes primeiro', () => {
    const { auditRuns } = fresh('../lib/independentAudit');
    const a = auditRuns.create({ target: 'self', targetPath: '/tmp/a' });
    const b = auditRuns.create({ target: 'self', targetPath: '/tmp/b' });
    const list = auditRuns.list(5);
    const ids = list.map((r) => r.id);
    assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));
  });
});
