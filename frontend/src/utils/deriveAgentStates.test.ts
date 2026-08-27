import { describe, it, expect } from 'vitest';
import { deriveAgentStates, idleAgents } from './deriveAgentStates';

describe('deriveAgentStates', () => {
  it('retorna todos idle quando não há task', () => {
    expect(deriveAgentStates(null)).toEqual(idleAgents());
  });

  it('modo forge: marca etapas anteriores como success e a etapa ativa como active', () => {
    const states = deriveAgentStates({ status: 'qa', config: { mode: 'forge' } });
    expect(states.architect).toBe('success');
    expect(states.coder).toBe('success');
    expect(states.qa).toBe('active');
    expect(states.security).toBe('idle');
  });

  it('modo validate: pula architect e coder desde o início', () => {
    const states = deriveAgentStates({ status: 'qa', config: { mode: 'validate' } });
    expect(states.architect).toBe('skipped');
    expect(states.coder).toBe('skipped');
    expect(states.qa).toBe('active');
  });

  it('awaiting_approval com pendingNextStage marca tudo antes dele como success', () => {
    const states = deriveAgentStates({
      status: 'awaiting_approval',
      pendingNextStage: 'security',
      config: { mode: 'forge' }
    });
    expect(states.architect).toBe('success');
    expect(states.coder).toBe('success');
    expect(states.qa).toBe('success');
    expect(states.security).toBe('idle');
  });

  it('awaiting_approval pendente em userFix marca userFix como active', () => {
    const states = deriveAgentStates({
      status: 'awaiting_approval',
      pendingNextStage: 'userFix',
      config: { mode: 'forge' }
    });
    expect(states.userFix).toBe('active');
  });

  it('pendente em report marca userFix como skipped (não passou por correção manual)', () => {
    const states = deriveAgentStates({
      status: 'awaiting_approval',
      pendingNextStage: 'report',
      config: { mode: 'forge' }
    });
    expect(states.userFix).toBe('skipped');
  });

  it('status completed marca tudo como success', () => {
    const states = deriveAgentStates({ status: 'completed', config: { mode: 'forge' } });
    for (const key of ['architect', 'coder', 'qa', 'security', 'debugger', 'healer', 'devops', 'human', 'reporter'] as const) {
      expect(states[key]).toBe('success');
    }
    expect(states.userFix).toBe('skipped');
  });

  it('completed com lastUserReport marca userFix como success em vez de skipped', () => {
    const states = deriveAgentStates({
      status: 'completed',
      config: { mode: 'forge', lastUserReport: 'corrigi o botão' }
    });
    expect(states.userFix).toBe('success');
  });

  it('completed em modo validate ainda pula architect/coder', () => {
    const states = deriveAgentStates({ status: 'completed', config: { mode: 'validate' } });
    expect(states.architect).toBe('skipped');
    expect(states.coder).toBe('skipped');
  });

  it('testes com alguma falha marcam qa como failed mesmo se a etapa ativa é outra', () => {
    const states = deriveAgentStates({
      status: 'security',
      config: { mode: 'forge' },
      tests: [
        { name: 'a', passed: true, error: null },
        { name: 'b', passed: false, error: 'falhou' }
      ]
    });
    expect(states.qa).toBe('failed');
  });

  it('testes todos passando marcam qa como success', () => {
    const states = deriveAgentStates({
      status: 'security',
      config: { mode: 'forge' },
      tests: [{ name: 'a', passed: true, error: null }]
    });
    expect(states.qa).toBe('success');
  });

  it('securityIssues presentes marcam security como failed', () => {
    const states = deriveAgentStates({
      status: 'debugger',
      config: { mode: 'forge' },
      securityIssues: [
        { id: 's1', severity: 'HIGH', title: 'XSS', description: 'input não sanitizado', remediation: 'sanitizar' }
      ]
    });
    expect(states.security).toBe('failed');
  });

  it('deployUrl presente marca devops como success quando ainda estava idle/active', () => {
    const states = deriveAgentStates({
      status: 'qa',
      config: { mode: 'forge' },
      deployUrl: 'http://localhost:4000'
    });
    expect(states.devops).toBe('success');
  });

  it('humanReport com passed=true marca human como success', () => {
    const states = deriveAgentStates({
      status: 'prodReady',
      config: { mode: 'forge' },
      humanReport: { passed: true }
    });
    expect(states.human).toBe('success');
  });

  it('humanReport com passed=false marca human como failed', () => {
    const states = deriveAgentStates({
      status: 'awaiting_approval',
      pendingNextStage: 'userFix',
      config: { mode: 'forge' },
      humanReport: { passed: false }
    });
    expect(states.human).toBe('failed');
  });
});
