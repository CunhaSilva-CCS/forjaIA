const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldRemediateSenior } = require('../lib/preflightPipeline');

describe('preflightPipeline', () => {
  it('shouldRemediateSenior quando reprovado ou há priorityFixes', () => {
    assert.equal(shouldRemediateSenior({ verdict: 'reprovado' }), true);
    assert.equal(shouldRemediateSenior({ verdict: 'aprovado', priorityFixes: ['x'] }), true);
    assert.equal(shouldRemediateSenior({ verdict: 'aprovado', priorityFixes: [] }), false);
    assert.equal(shouldRemediateSenior(null), false);
  });
});
