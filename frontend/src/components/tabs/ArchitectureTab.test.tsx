import { describe, expect, it } from 'vitest';
import { buildPlanPatch, normalizeArchitectPlan, planHasArchitectureDetails } from '../../utils/architectPlan';

describe('architectPlan utils', () => {
  it('normaliza plano enriquecido e mantém retrocompatibilidade', () => {
    const plan = normalizeArchitectPlan(
      {
        files: [{ name: 'a.js', path: 'a.js' }],
        apiContracts: [{ method: 'GET', path: '/health', description: 'ping' }]
      },
      { adrs: [{ id: 'ADR-1', title: 'X', status: 'Proposto', context: '', decision: '', consequences: '' }] }
    );
    expect(plan.apiContracts).toHaveLength(1);
    expect(plan.adrs).toHaveLength(1);
    expect(plan.dataModels).toEqual([]);
  });

  it('buildPlanPatch inclui campos enriquecidos no patch de aprovação', () => {
    const patch = buildPlanPatch({
      adrs: [],
      files: [{ name: 'server.js', path: 'server.js', purpose: 'HTTP' }],
      apiContracts: [{ method: 'POST', path: '/api/login', description: 'login' }],
      dataModels: [{ name: 'User', fields: [{ name: 'email', type: 'string', required: true }] }],
      dependencies: [{ name: 'express', version: '^4', reason: 'HTTP' }],
      nonFunctional: [{ area: 'segurança', requirement: 'rate limit' }],
      testScenarios: [
        { name: 'Health', method: 'GET', path: '/health', expectedStatus: '200', expect: 'none' },
        { name: 'Login', method: 'POST', path: '/api/login', expectedStatus: '200', expect: 'token' }
      ]
    });
    expect(patch.files[0].purpose).toBe('HTTP');
    expect(patch.apiContracts).toHaveLength(1);
    expect(patch.testScenarios).toHaveLength(2);
    expect(planHasArchitectureDetails(patch)).toBe(true);
  });
});
