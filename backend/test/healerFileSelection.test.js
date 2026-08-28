const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';

describe('healer.collectFlaggedPaths', () => {
  it('coleta paths de securityReport.issues[].file', () => {
    const { collectFlaggedPaths } = require('../agent/healer');
    const known = new Set(['src/app.ts', 'src/routes/auth.ts', 'package.json']);
    const flagged = collectFlaggedPaths(
      known,
      { issues: [{ file: 'src/routes/auth.ts', title: 'CORS aberto' }] },
      null
    );
    assert.deepEqual([...flagged], ['src/routes/auth.ts']);
  });

  it('coleta paths de diagnosis.recommendedFixes[].files e rootCauses[].affectedFiles', () => {
    const { collectFlaggedPaths } = require('../agent/healer');
    const known = new Set(['a.js', 'b.js', 'c.js']);
    const flagged = collectFlaggedPaths(known, null, {
      recommendedFixes: [{ priority: 1, action: 'corrigir a.js', files: ['a.js'] }],
      rootCauses: [{ id: 'X', affectedFiles: ['c.js'] }]
    });
    assert.deepEqual([...flagged].sort(), ['a.js', 'c.js']);
  });

  it('ignora paths que não existem na lista de arquivos conhecidos', () => {
    const { collectFlaggedPaths } = require('../agent/healer');
    const known = new Set(['a.js']);
    const flagged = collectFlaggedPaths(known, { issues: [{ file: 'nao-existe.js' }] }, null);
    assert.equal(flagged.size, 0);
  });
});

describe('healer.findDependents', () => {
  it('acha arquivos que citam o nome-base de um arquivo sinalizado', () => {
    const { findDependents } = require('../agent/healer');
    const files = [
      { path: 'src/middleware/auth.ts', content: 'export function authenticate() {}' },
      { path: 'src/routes/clientes.routes.ts', content: "import { authenticate } from '../middleware/auth';" },
      { path: 'src/utils/format.ts', content: 'export function formatDate() {}' }
    ];
    const dependents = findDependents(files, new Set(['src/middleware/auth.ts']));
    assert.deepEqual([...dependents], ['src/routes/clientes.routes.ts']);
  });

  it('não inclui o próprio arquivo já sinalizado', () => {
    const { findDependents } = require('../agent/healer');
    const files = [{ path: 'auth.ts', content: 'authenticate self-reference authenticate' }];
    const dependents = findDependents(files, new Set(['auth.ts']));
    assert.equal(dependents.size, 0);
  });
});
