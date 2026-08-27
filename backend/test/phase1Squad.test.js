const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'phase1-admin-token-with-24chars';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'false';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-p1-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-p1-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3097';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('Phase 1 RBAC', () => {
  it('maps stages to roles and blocks unauthorized approve', () => {
    const { canApproveStage, assertCanApprove, STAGE_ROLES } = fresh('../lib/rbac');
    assert.ok(STAGE_ROLES.qa.includes('qa'));
    assert.equal(canApproveStage({ role: 'qa' }, 'human'), true);
    assert.equal(canApproveStage({ role: 'qa' }, 'deploy'), false);
    assert.throws(() => assertCanApprove({ role: 'member' }, 'coder'), /não pode aprovar/i);
  });
});

describe('Phase 1 team + queue', () => {
  it('seeds members and enqueues runs', () => {
    fresh('../lib/config');
    const { getDb, runs } = fresh('../lib/db');
    getDb();
    const { team } = fresh('../lib/team');
    const info = team.listWithBootstrapHints();
    assert.ok(info.members.length >= 3);
    const leadTok = info.bootstrapTokens.lead;
    const lead = team.resolveByToken(leadTok);
    assert.equal(lead.role, 'lead');

    const { runQueue } = fresh('../lib/runQueue');
    const q = runQueue.enqueue({
      prompt: 'fila test',
      config: { mode: 'forge', targetPath: 'x' },
      owner: lead,
      mode: 'forge'
    });
    assert.equal(q.status, 'queued');
    assert.equal(runs.listQueued().length, 1);
  });
});
