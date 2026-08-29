const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ROLES, normalizeRole, canStartRun, canCancelRun, canReportIssue } = require('../lib/rbac');

describe('rbac — papel viewer (ADR-025, achado real)', () => {
  it('viewer é um papel reconhecido', () => {
    assert.ok(ROLES.includes('viewer'));
    assert.equal(normalizeRole('viewer'), 'viewer');
  });

  it('achado real: canStartRun antes só checava Boolean(member) — agora exclui viewer', () => {
    assert.equal(canStartRun({ role: 'viewer' }), false);
    assert.equal(canStartRun(null), false);
    assert.equal(canStartRun({ role: 'member' }), true);
    assert.equal(canStartRun({ role: 'admin', isAdmin: true }), true);
  });

  it('achado real: /api/agent/cancel não tinha checagem nenhuma — canCancelRun exclui viewer', () => {
    assert.equal(canCancelRun({ role: 'viewer' }), false);
    assert.equal(canCancelRun(null), false);
    assert.equal(canCancelRun({ role: 'member' }), true);
    assert.equal(canCancelRun({ role: 'lead' }), true);
  });

  it('canReportIssue exclui viewer, permite os demais papéis', () => {
    assert.equal(canReportIssue({ role: 'viewer' }), false);
    assert.equal(canReportIssue({ role: 'qa' }), true);
  });
});
