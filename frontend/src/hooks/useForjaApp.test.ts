import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useForjaApp } from './useForjaApp';
import { api } from '../services/api';
import { connectAgentSocket } from '../services/ws';

// useForjaApp dispara vários efeitos de montagem (docker/ollama/preferences/workspace/projetos/
// runs/health/team/board/cursor/reliability/uso de LLM/auditoria/serviço) — mocka a superfície
// inteira de api.* com respostas neutras/vazias, e connectAgentSocket pra capturar o handler de
// mensagens sem abrir um WebSocket real.
vi.mock('../services/api', () => ({
  api: {
    health: vi.fn().mockResolvedValue({ ok: true, hasGeminiKey: false, hasOpenAIKey: false, hasAnthropicKey: false, llm: {} }),
    dockerStatus: vi.fn().mockResolvedValue({ active: false, required: false }),
    ollamaModels: vi.fn().mockResolvedValue({ online: false, models: [] }),
    llmStatus: vi.fn().mockResolvedValue({ provider: 'ollama', model: null, ok: false, configured: false, latencyMs: 0, detail: '' }),
    llmUsage: vi.fn().mockResolvedValue({ periods: {}, cooldowns: [] }),
    clearProviderCooldown: vi.fn().mockResolvedValue({ success: true }),
    workspace: vi.fn().mockResolvedValue({ workspaceRoot: '/tmp', defaultPath: '.' }),
    preferences: {
      get: vi.fn().mockResolvedValue({ styleRules: [], feedbacks: [] }),
      set: vi.fn()
    },
    projects: {
      list: vi.fn().mockResolvedValue([]),
      ensure: vi.fn(),
      remove: vi.fn()
    },
    runs: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      reliabilityStats: vi.fn().mockResolvedValue({
        measuredRuns: 0,
        finishedWithoutInterventionRate: null,
        avgHealingAttempts: null,
        userFixInvokedRate: null,
        avgTestPassRate: null,
        humanPassedRate: null,
        preflightPassRate: null,
        avgPreflightFixAttempts: null,
        forceQaRate: null,
        preflightQaParityRate: null
      }),
      downloadExport: vi.fn(),
      downloadReportPdf: vi.fn(),
      fileVersions: vi.fn()
    },
    audit: {
      run: vi.fn(),
      list: vi.fn().mockResolvedValue({ runs: [] }),
      get: vi.fn()
    },
    team: {
      me: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue(null),
      board: vi.fn().mockResolvedValue(null),
      members: { create: vi.fn() }
    },
    services: {
      status: vi.fn().mockResolvedValue({ online: true, host: '127.0.0.1', port: 3001, pids: [], watch: { enabled: false, pid: null } }),
      action: vi.fn()
    },
    browse: vi.fn(),
    mkdir: vi.fn(),
    run: vi.fn(),
    validate: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn()
  }
}));

vi.mock('../services/ws', () => ({
  connectAgentSocket: vi.fn((onMessage: (event: string, data: unknown) => void, onStatus: (c: boolean) => void) => {
    onStatus(true);
    // Expõe o handler no próprio mock pra o teste poder disparar mensagens.
    (connectAgentSocket as unknown as { __lastHandler?: typeof onMessage }).__lastHandler = onMessage;
    return () => undefined;
  })
}));

function emitWsMessage(event: string, data: unknown) {
  const handler = (connectAgentSocket as unknown as { __lastHandler?: (event: string, data: unknown) => void }).__lastHandler;
  if (!handler) throw new Error('handler de WS não capturado — connectAgentSocket não foi chamado ainda');
  act(() => {
    handler(event, data);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restaura os defaults consumidos pelo clearAllMocks (mockResolvedValue é limpo junto).
  vi.mocked(api.health).mockResolvedValue({ ok: true, hasGeminiKey: false, hasOpenAIKey: false, hasAnthropicKey: false, llm: {} } as never);
  vi.mocked(api.dockerStatus).mockResolvedValue({ active: false, required: false });
  vi.mocked(api.ollamaModels).mockResolvedValue({ online: false, models: [] });
  vi.mocked(api.llmStatus).mockResolvedValue({ provider: 'ollama', model: null, ok: false, configured: false, latencyMs: 0, detail: '' });
  vi.mocked(api.llmUsage).mockResolvedValue({ periods: {}, cooldowns: [] });
  vi.mocked(api.workspace).mockResolvedValue({ workspaceRoot: '/tmp', defaultPath: '.' });
  vi.mocked(api.preferences.get).mockResolvedValue({ styleRules: [], feedbacks: [] });
  vi.mocked(api.projects.list).mockResolvedValue([]);
  vi.mocked(api.runs.list).mockResolvedValue([]);
  vi.mocked(api.runs.reliabilityStats).mockResolvedValue({
    measuredRuns: 0,
    finishedWithoutInterventionRate: null,
    avgHealingAttempts: null,
    userFixInvokedRate: null,
    avgTestPassRate: null,
    humanPassedRate: null,
    preflightPassRate: null,
    avgPreflightFixAttempts: null,
    forceQaRate: null,
    preflightQaParityRate: null
  });
  vi.mocked(api.audit.list).mockResolvedValue({ runs: [] });
  vi.mocked(api.services.status).mockResolvedValue({
    online: true,
    host: '127.0.0.1',
    port: 3001,
    pids: [],
    watch: { enabled: false, pid: null }
  });
});

describe('useForjaApp — smoke test', () => {
  it('monta sem lançar e chega num estado ocioso coerente', async () => {
    const { result } = renderHook(() => useForjaApp());
    await waitFor(() => expect(api.runs.list).toHaveBeenCalled());
    expect(result.current.isExecuting).toBe(false);
    expect(result.current.logs).toEqual([]);
    expect(result.current.currentTab).toBeTruthy();
  });
});

describe('useForjaApp — sync-state (ADR-022, achado real, lacuna fechada)', () => {
  it('mescla logs vindos de sync-state com logs já recebidos ao vivo (agent-log), não substitui', async () => {
    vi.mocked(api.runs.get).mockResolvedValue({
      id: 'run-1',
      project_id: null,
      prompt: 'x',
      status: 'coder',
      started_at: '2026-08-29T10:00:00.000Z',
      events: [{ agent: 'qa', message: 'do snapshot', type: 'info', created_at: '2026-08-29T10:00:01.000Z' }]
    } as never);

    const { result } = renderHook(() => useForjaApp());
    await waitFor(() => expect(api.runs.list).toHaveBeenCalled());

    // Uma linha "ao vivo" chega via agent-log ANTES do fetch de sync-state resolver.
    emitWsMessage('agent-log', { agent: 'security', message: 'ao vivo, ainda não no snapshot', type: 'info', timestamp: '2026-08-29T10:00:02.000Z' });
    expect(result.current.logs).toHaveLength(1);

    emitWsMessage('sync-state', { isExecuting: true, task: { id: 'run-1', status: 'coder' } });

    // Achado real: sem a mescla, o array virava só o do snapshot (1 linha), apagando a linha ao
    // vivo. Com a mescla, as duas convivem.
    await waitFor(() => expect(result.current.logs.length).toBe(2));
    expect(result.current.logs.some((l) => l.message === 'do snapshot')).toBe(true);
    expect(result.current.logs.some((l) => l.message === 'ao vivo, ainda não no snapshot')).toBe(true);
  });

  it('não aplica um fetch de sync-state atrasado se a run mudou nesse meio-tempo', async () => {
    let resolveGet: (value: Awaited<ReturnType<typeof api.runs.get>>) => void = () => undefined;
    vi.mocked(api.runs.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        })
    );

    const { result } = renderHook(() => useForjaApp());
    await waitFor(() => expect(api.runs.list).toHaveBeenCalled());

    emitWsMessage('sync-state', { isExecuting: true, task: { id: 'run-antiga', status: 'coder' } });
    // Troca de run ANTES do fetch da run antiga resolver.
    emitWsMessage('task-started', { id: 'run-nova', status: 'planning', config: {} });
    expect(result.current.currentRunId).toBe('run-nova');

    act(() => {
      resolveGet({
        id: 'run-antiga',
        project_id: null,
        prompt: 'x',
        status: 'coder',
        started_at: '2026-08-29T10:00:00.000Z',
        events: [{ agent: 'qa', message: 'da run antiga', type: 'info', created_at: '2026-08-29T10:00:00.000Z' }]
      } as never);
    });

    // Dá tempo da promise (já resolvida) processar — se o guard falhar, isso vaza log da run
    // errada pro estado atual.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.logs.some((l) => l.message === 'da run antiga')).toBe(false);
  });
});

describe('useForjaApp — eventos de auditoria independente (ADR-021/023)', () => {
  it('audit-started e audit-finished rebuscam a lista de auditorias', async () => {
    const { result } = renderHook(() => useForjaApp());
    await waitFor(() => expect(api.audit.list).toHaveBeenCalledTimes(1));

    vi.mocked(api.audit.list).mockResolvedValue({
      runs: [
        {
          id: 'audit-1',
          target: 'self',
          targetPath: '/repo',
          status: 'completed',
          findings: [],
          tools: {},
          summary: 'nenhum achado',
          error: null,
          startedAt: '2026-08-29T10:00:00.000Z',
          finishedAt: '2026-08-29T10:00:05.000Z'
        }
      ]
    });

    emitWsMessage('audit-finished', { id: 'audit-1', summary: 'nenhum achado' });

    await waitFor(() => expect(result.current.auditRuns).toHaveLength(1));
    expect(result.current.auditRuns[0].id).toBe('audit-1');
  });
});

describe('useForjaApp — tokens-updated mantém o card de uso ao vivo', () => {
  it('atualiza tokenStats e rebusca llmUsage quando uma chamada de LLM termina', async () => {
    const { result } = renderHook(() => useForjaApp());
    await waitFor(() => expect(api.runs.list).toHaveBeenCalled());

    vi.mocked(api.llmUsage).mockResolvedValue({
      periods: { gemini: { today: { calls: 1, tokens: 500 }, week: { calls: 1, tokens: 500 }, month: { calls: 1, tokens: 500 } } },
      cooldowns: []
    });

    emitWsMessage('tokens-updated', { prompt: 300, completion: 200, total: 500, calls: 1, estimatedCostUsd: 0.01 });

    await waitFor(() => expect(result.current.tokenStats.total).toBe(500));
    expect(result.current.tokenStats.estimatedCostUsd).toBe(0.01);
  });
});
