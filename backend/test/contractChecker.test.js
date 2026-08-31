const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  checkImports,
  checkPlanContractAlignment,
  extractRoutesFromFiles,
  normalizeRoutePath
} = require('../lib/contractChecker');

describe('contractChecker', () => {
  it('normalizeRoutePath trata parâmetros dinâmicos', () => {
    assert.equal(normalizeRoutePath('/api/users/:id'), '/api/users/:param');
    assert.equal(normalizeRoutePath('/api/users/{id}'), '/api/users/:param');
  });

  it('extractRoutesFromFiles encontra rotas Express', () => {
    const routes = extractRoutesFromFiles([
      {
        path: 'src/server.js',
        content: `
          app.get('/health', handler);
          app.post('/api/tasks', create);
          router.delete('/api/tasks/:id', remove);
        `
      }
    ]);
    assert.ok(routes.has('GET /health'));
    assert.ok(routes.has('POST /api/tasks'));
    assert.ok(routes.has('DELETE /api/tasks/:id'));
  });

  it('checkImports reprova import relativo ausente', () => {
    const result = checkImports([
      { path: 'index.js', content: "const x = require('./missing.js');" }
    ]);
    assert.equal(result.passed, false);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0].import, './missing.js');
  });

  it('checkImports aprova import resolvível', () => {
    const result = checkImports([
      { path: 'index.js', content: "const x = require('./lib.js');" },
      { path: 'lib.js', content: 'module.exports = {};' }
    ]);
    assert.equal(result.passed, true);
  });

  it('checkPlanContractAlignment detecta rotas ausentes do plano', () => {
    const plan = {
      apiContracts: [{ method: 'GET', path: '/api/items' }],
      testScenarios: [{ method: 'POST', path: '/api/items', name: 'criar item' }]
    };
    const files = [{ path: 'server.js', content: "app.get('/health', () => {});" }];
    const result = checkPlanContractAlignment(files, plan);
    assert.equal(result.passed, false);
    assert.ok(result.missing.some((m) => m.includes('GET /api/items')));
    assert.ok(result.missing.some((m) => m.includes('POST /api/items')));
  });

  it('checkPlanContractAlignment aprova quando rotas cobrem contratos', () => {
    const plan = {
      apiContracts: [{ method: 'GET', path: '/api/items' }],
      testScenarios: [{ method: 'POST', path: '/api/items', name: 'criar' }]
    };
    const files = [
      {
        path: 'server.js',
        content: `
          app.get('/api/items', list);
          app.post('/api/items', create);
        `
      }
    ];
    const result = checkPlanContractAlignment(files, plan);
    assert.equal(result.passed, true);
  });
});
