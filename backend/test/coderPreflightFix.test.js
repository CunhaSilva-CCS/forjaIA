const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeFilePatches } = require('../lib/coderPreflightFix');

describe('coderPreflightFix', () => {
  it('mergeFilePatches sobrescreve só os paths retornados', () => {
    const merged = mergeFilePatches(
      [
        { name: 'a.js', path: 'a.js', content: 'old-a' },
        { name: 'b.js', path: 'b.js', content: 'keep-b' }
      ],
      [{ path: 'a.js', content: 'new-a' }]
    );
    assert.equal(merged.find((f) => f.path === 'a.js')?.content, 'new-a');
    assert.equal(merged.find((f) => f.path === 'b.js')?.content, 'keep-b');
  });
});
