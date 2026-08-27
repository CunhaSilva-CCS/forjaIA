import type { AgentName, AgentState, Task } from '../types/agent';

export const idleAgents = (): Record<AgentName, AgentState> => ({
  architect: 'idle',
  coder: 'idle',
  qa: 'idle',
  security: 'idle',
  debugger: 'idle',
  healer: 'idle',
  devops: 'idle',
  human: 'idle',
  userFix: 'idle',
  reporter: 'idle'
});

/**
 * Reconstrói o estado visual de cada agente (idle/active/success/failed/skipped)
 * a partir de um snapshot de task vindo da API/WebSocket. Usado tanto para
 * sincronizar o estado inicial (sync-state) quanto para recompor gates de aprovação.
 */
export function deriveAgentStates(task: Task | null | undefined): Record<AgentName, AgentState> {
  const next = idleAgents();
  if (!task) return next;
  const mode = task.config?.mode === 'validate' ? 'validate' : 'forge';
  const status = String(task.status || '');
  const pending = task.pendingNextStage || task.config?.pendingNextStage || null;
  const order: AgentName[] =
    mode === 'validate'
      ? ['qa', 'security', 'debugger', 'healer', 'devops', 'human', 'reporter']
      : ['architect', 'coder', 'qa', 'security', 'debugger', 'healer', 'devops', 'human', 'reporter'];

  if (mode === 'validate') {
    next.architect = 'skipped';
    next.coder = 'skipped';
  }

  const stageToAgent: Record<string, AgentName> = {
    planning: 'architect',
    coding: 'coder',
    coder: 'coder',
    qa: 'qa',
    security: 'security',
    debugger: 'debugger',
    healer: 'healer',
    devops: 'devops',
    deploy: 'devops',
    human: 'human',
    userFix: 'userFix',
    prodReady: 'devops',
    report: 'reporter',
    reporter: 'reporter'
  };

  if (status === 'awaiting_approval' && pending) {
    if (pending === 'userFix') {
      for (const a of order) {
        if (a === 'human' && task.humanReport) {
          next.human = task.humanReport.passed === false ? 'failed' : 'success';
        } else if (['architect', 'coder', 'qa', 'security', 'debugger', 'healer', 'devops', 'human'].includes(a)) {
          // leave idle unless we have evidence below
        }
      }
      next.userFix = 'active';
    } else {
      const idx = order.indexOf(stageToAgent[pending] || (pending as AgentName));
      for (let i = 0; i < order.length; i += 1) {
        if (i < idx) next[order[i]] = 'success';
      }
      if (pending === 'report' || pending === 'reporter' || pending === 'prodReady') {
        next.userFix = 'skipped';
      }
    }
    if (mode === 'validate' && (pending === 'qa' || !pending)) {
      // still at first quality gate after load
    }
  } else if (status === 'completed') {
    for (const a of order) next[a] = 'success';
    if (mode === 'validate') {
      next.architect = 'skipped';
      next.coder = 'skipped';
    }
    next.userFix = task.config?.lastUserReport ? 'success' : 'skipped';
  } else if (stageToAgent[status]) {
    const active = stageToAgent[status];
    const idx = order.indexOf(active);
    if (status === 'userFix') {
      next.userFix = 'active';
    } else {
      for (let i = 0; i < order.length; i += 1) {
        if (i < idx) next[order[i]] = 'success';
        if (i === idx) next[order[i]] = 'active';
      }
    }
  }

  if (Array.isArray(task.tests) && task.tests.length) {
    next.qa = task.tests.every((t) => t.passed) ? 'success' : 'failed';
  }
  if (Array.isArray(task.securityIssues) && task.securityIssues.length) {
    next.security = 'failed';
  } else if (
    status === 'awaiting_approval' &&
    pending &&
    ['debugger', 'healer', 'devops', 'deploy', 'human', 'userFix', 'prodReady', 'report'].includes(pending)
  ) {
    if (next.security === 'idle') next.security = 'success';
  }
  if (task.deployUrl) next.devops = next.devops === 'idle' || next.devops === 'active' ? 'success' : next.devops;
  if (task.humanReport) {
    next.human = task.humanReport.passed ? 'success' : 'failed';
  }
  return next;
}
