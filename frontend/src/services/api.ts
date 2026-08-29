import { API_BASE, getStoredToken } from '../config';
import type { ADR, AuditRun, Project, RunSummary, Task, TeamBoard, TeamInfo } from '../types/agent';

interface RunQueuedResponse {
  queued?: boolean;
  message?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // ignore
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res as unknown as T;
}

function filenameFromDisposition(value: string | null, fallback: string): string {
  const match = value ? /filename="?([^"; ]+)"?/i.exec(value) : null;
  return match?.[1] || fallback;
}

async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = getStoredToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const filename = filenameFromDisposition(res.headers.get('content-disposition'), fallbackName);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export const api = {
  health: () => request<Record<string, unknown>>('/api/health'),
  llmStatus: (provider?: string) =>
    request<{
      provider: string;
      model: string | null;
      ok: boolean;
      configured: boolean;
      latencyMs: number;
      detail: string;
    }>(`/api/llm/status${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`),
  status: () => request<{ isExecuting: boolean; task: Task | null }>('/api/agent/status'),
  llmUsage: () =>
    request<{
      periods: Record<
        string,
        {
          today: { calls: number; tokens: number };
          week: { calls: number; tokens: number };
          month: { calls: number; tokens: number };
        }
      >;
      cooldowns: Array<{ provider: string; until: string; reason: string }>;
    }>('/api/llm/usage'),
  clearProviderCooldown: (provider: string) =>
    request<{ success: boolean }>(`/api/llm/cooldown/${encodeURIComponent(provider)}/clear`, {
      method: 'POST',
      body: '{}'
    }),
  dockerStatus: () => request<{ active: boolean; required: boolean }>('/api/docker/status'),
  ollamaModels: () => request<{ online: boolean; models: string[] }>('/api/ollama/models'),
  workspace: () => request<{ workspaceRoot: string; defaultPath: string }>('/api/workspace'),
  preferences: {
    get: () =>
      request<{ styleRules: string[]; feedbacks: unknown[]; defaults?: string[] }>('/api/preferences'),
    set: (styleRules: string[]) =>
      request('/api/preferences', {
        method: 'POST',
        body: JSON.stringify({ styleRules, feedbacks: [] })
      }),
    resetSenior: () =>
      request<{ success: boolean; data: { styleRules: string[] }; message?: string }>(
        '/api/preferences/reset-senior',
        { method: 'POST', body: '{}' }
      )
  },
  projects: {
    list: () => request<Project[]>('/api/projects'),
    create: (name: string, path: string) =>
      request<Project>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, path })
      }),
    ensure: (name: string, path: string) =>
      request<Project>('/api/projects/ensure', {
        method: 'POST',
        body: JSON.stringify({ name, path })
      }),
    remove: (id: string) => request(`/api/projects/${id}`, { method: 'DELETE' })
  },
  runs: {
    list: () => request<RunSummary[]>('/api/runs'),
    get: (id: string) => request<RunSummary>(`/api/runs/${id}`),
    downloadExport: (id: string) => downloadFile(`/api/runs/${id}/export`, `${id}.zip`),
    downloadReportPdf: (id: string) => downloadFile(`/api/runs/${id}/report.pdf`, `${id}.pdf`),
    fileVersions: (id: string, filePath: string) =>
      request<Array<{ id: number; path: string; content: string; version: number }>>(
        `/api/runs/${id}/files/${encodeURIComponent(filePath)}/versions`
      ),
    reliabilityStats: () =>
      request<{
        measuredRuns: number;
        finishedWithoutInterventionRate: number | null;
        avgHealingAttempts: number | null;
        userFixInvokedRate: number | null;
        avgTestPassRate: number | null;
        humanPassedRate: number | null;
      }>('/api/runs/stats/reliability')
  },
  audit: {
    run: (target: 'self' | 'project', projectPath?: string) =>
      request<{ id: string; target: string; targetPath: string; status: string }>('/api/audit/run', {
        method: 'POST',
        body: JSON.stringify({ target, projectPath })
      }),
    list: () => request<{ runs: AuditRun[] }>('/api/audit/runs'),
    get: (id: string) => request<AuditRun>(`/api/audit/runs/${id}`)
  },
  browse: (path: string) =>
    request<{
      workspaceRoot: string;
      currentPath: string;
      parentPath: string | null;
      exists?: boolean;
      listingPath?: string;
      directories: { name: string; path: string }[];
    }>('/api/fs/browse', {
      method: 'POST',
      body: JSON.stringify({ path })
    }),
  mkdir: (path: string) =>
    request<{
      workspaceRoot: string;
      currentPath: string;
      parentPath: string | null;
      exists?: boolean;
      directories: { name: string; path: string }[];
    }>('/api/fs/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path })
    }),
  run: (prompt: string, config: Record<string, unknown>) =>
    request<RunQueuedResponse>('/api/agent/run', {
      method: 'POST',
      body: JSON.stringify({ prompt, config })
    }),
  validate: (sourcePath: string, config: Record<string, unknown> = {}) =>
    request<RunQueuedResponse>('/api/agent/validate', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, config })
    }),
  approve: (config: Record<string, unknown>, planPatch?: { adrs?: ADR[]; files?: unknown[] }) =>
    request('/api/agent/approve', {
      method: 'POST',
      body: JSON.stringify({ config, planPatch })
    }),
  userReport: (message: string) =>
    request<{ success: boolean; nextStage: string; message: string }>('/api/agent/user-report', {
      method: 'POST',
      body: JSON.stringify({ message })
    }),
  cancel: () => request('/api/agent/cancel', { method: 'POST' }),
  team: {
    list: () => request<TeamInfo>('/api/team'),
    me: () =>
      request<{ id: string; name: string; role: string; isAdmin: boolean }>('/api/team/me'),
    board: () => request<TeamBoard>('/api/team/board'),
    createMember: (body: { name: string; role: string; token: string }) =>
      request('/api/team/members', { method: 'POST', body: JSON.stringify(body) })
  },
  services: {
    status: () =>
      request<{
        online: boolean;
        host: string;
        port: number;
        pids: number[];
        watch: { enabled: boolean; pid: number | null };
        control?: { watchRunning: boolean; mode: string };
        health?: { ok: boolean; error?: string };
      }>('/api/services/status'),
    action: (action: 'start' | 'stop' | 'restart' | 'watch') =>
      request<{ ok: boolean; action: string; message: string; result: unknown }>(
        `/api/services/${action}`,
        { method: 'POST', body: '{}' }
      )
  }
};
