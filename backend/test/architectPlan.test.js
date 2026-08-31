const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePlan,
  mergePlanAmendments,
  buildCoderHandoff,
  summarizePlan,
  getPlanTestCases,
  deriveTestScenariosFromContracts
} = require('../lib/architectPlan');

describe('architectPlan', () => {
  it('normalizePlan preenche defaults e normaliza campos enriquecidos', () => {
    const plan = normalizePlan({
      files: [{ path: 'server.js', purpose: 'HTTP' }],
      adrs: [{ id: 'ADR-1', title: 'MVC', status: 'Proposto' }],
      apiContracts: [{ method: 'get', path: '/health', description: 'ping' }],
      dataModels: [{ name: 'User', fields: [{ name: 'email', type: 'string', required: true }] }],
      dependencies: ['express', { name: 'helmet', version: '^7', reason: 'headers' }],
      nonFunctional: { seguranca: 'JWT via env' }
    });

    assert.equal(plan.files[0].name, 'server.js');
    assert.equal(plan.files[0].purpose, 'HTTP');
    assert.equal(plan.apiContracts[0].method, 'GET');
    assert.equal(plan.dataModels[0].fields[0].name, 'email');
    assert.equal(plan.dependencies[0].name, 'express');
    assert.equal(plan.nonFunctional[0].area, 'seguranca');
  });

  it('normalizePlan é retrocompatível com planos antigos (só files/adrs)', () => {
    const plan = normalizePlan({
      files: [{ name: 'a.js', path: 'a.js' }],
      adrs: [{ id: 'ADR-1', title: 'X', status: 'Proposto', context: '', decision: '', consequences: '' }]
    });
    assert.deepEqual(plan.apiContracts, []);
    assert.deepEqual(plan.dataModels, []);
    assert.match(summarizePlan(plan), /1 arquivos, 1 ADRs/);
  });

  it('mergePlanAmendments deduplica por chave estável', () => {
    const base = normalizePlan({
      files: [{ name: 'server.js', path: 'server.js' }],
      apiContracts: [{ method: 'GET', path: '/health', description: 'old' }]
    });
    const merged = mergePlanAmendments(base, {
      files: [{ name: 'server.js', path: 'server.js', purpose: 'entry' }],
      apiContracts: [{ method: 'GET', path: '/health', description: 'updated' }],
      adrs: [{ id: 'ADR-2', title: 'Novo', status: 'Proposto', context: 'c', decision: 'd', consequences: 'e' }]
    });
    assert.equal(merged.files[0].purpose, 'entry');
    assert.equal(merged.apiContracts[0].description, 'updated');
    assert.equal(merged.adrs.length, 1);
    assert.equal(merged.adrs[0].id, 'ADR-2');
  });

  it('buildCoderHandoff inclui ADRs, contratos e NFRs para o coder', () => {
    const handoff = buildCoderHandoff({
      files: [{ name: 'server.js', path: 'server.js' }],
      adrs: [{ id: 'ADR-1', title: 'JWT', status: 'Proposto', context: 'c', decision: 'd', consequences: 'e' }],
      apiContracts: [{ method: 'POST', path: '/api/login', description: 'login' }],
      dataModels: [{ name: 'User', fields: [{ name: 'email', type: 'string', required: true }] }],
      dependencies: [{ name: 'express', reason: 'HTTP' }],
      nonFunctional: [{ area: 'segurança', requirement: 'rate limit' }],
      seniorReview: { summary: 'Plano sólido', risks: ['Brute force em login'] }
    });

    assert.match(handoff, /ADRs \(1\)/);
    assert.match(handoff, /Contratos de API \(1\)/);
    assert.match(handoff, /Modelos de dados \(1\)/);
    assert.match(handoff, /Dependências aprovadas \(1\)/);
    assert.match(handoff, /Requisitos não-funcionais \(1\)/);
    assert.match(handoff, /Plano sólido/);
    assert.match(handoff, /Brute force em login/);
    assert.match(handoff, /Não invente rotas/);
  });
});

describe('architectPlan — testScenarios', () => {
  it('deriveTestScenariosFromContracts gera casos mínimos a partir de contratos auth', () => {
    const scenarios = deriveTestScenariosFromContracts([
      {
        method: 'POST',
        path: '/api/auth/register',
        description: 'Registro',
        auth: false,
        request: { email: 'string', password: 'string', name: 'string' }
      },
      {
        method: 'POST',
        path: '/api/auth/login',
        description: 'Login',
        auth: false,
        request: { email: 'string', password: 'string' }
      },
      {
        method: 'GET',
        path: '/api/auth/me',
        description: 'Perfil',
        auth: 'Bearer JWT'
      }
    ]);
    assert.ok(scenarios.length >= 2);
    assert.ok(scenarios.some((s) => s.path === '/health'));
    assert.ok(scenarios.some((s) => s.path === '/api/auth/login' && s.expect === 'token'));
  });

  it('normalizePlan preenche testScenarios quando ausentes', () => {
    const plan = normalizePlan({
      files: [{ path: 'server.js' }],
      adrs: [{ id: 'ADR-1', title: 'X', status: 'Proposto' }],
      apiContracts: [{ method: 'GET', path: '/api/items', description: 'Lista' }]
    });
    assert.ok(plan.testScenarios.length >= 2);
    assert.equal(getPlanTestCases(plan).length, plan.testScenarios.length);
  });

  it('buildCoderHandoff inclui cenários de teste aprovados', () => {
    const handoff = buildCoderHandoff({
      files: [{ name: 'server.js', path: 'server.js' }],
      adrs: [],
      testScenarios: [
        { name: 'Health', method: 'GET', path: '/health', expectedStatus: '200', expect: 'none' }
      ]
    });
    assert.match(handoff, /Cenários de teste aprovados/);
    assert.match(handoff, /\/health/);
  });
});
