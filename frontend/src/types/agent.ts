export interface LogLine {
  agent: string;
  message: string;
  type: string;
  timestamp: string;
  runId?: string | null;
}

export interface FileData {
  name: string;
  path: string;
  content: string;
}

export interface ADR {
  id: string;
  title: string;
  status: string;
  context: string;
  decision: string;
  consequences: string;
}

export interface TestItem {
  name: string;
  passed: boolean;
  error: string | null;
}

export interface SecurityIssue {
  id: string;
  title: string;
  severity: string;
  file?: string;
  description: string;
  remediation: string;
}

export interface PerformanceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rps: number;
  avgLatency: number;
  successRate: number;
  target?: string;
  chaosMode?: string;
}

export interface ChaosEvent {
  name: string;
  latency: number;
  loss: number;
  log: string;
}

export interface Diagnosis {
  summary: string;
  severity: string;
  rootCauses: Array<{
    id: string;
    title: string;
    confidence: number;
    evidence: string;
    affectedFiles: string[];
  }>;
  hypotheses: Array<{
    id: string;
    statement: string;
    howToVerify: string;
  }>;
  reproductionSteps: string[];
  recommendedFixes: Array<{
    priority: number;
    action: string;
    files: string[];
  }>;
  notesForHealer: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  created_at: string | null;
  updated_at?: string | null;
  source?: 'registered' | 'workspace';
  existsOnDisk?: boolean;
}

export interface RunSummary {
  id: string;
  project_id: string | null;
  prompt: string;
  status: string;
  deploy_url?: string | null;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
  files?: FileData[];
  adrs?: ADR[];
  tests?: TestItem[];
  securityIssues?: SecurityIssue[];
  performanceMetrics?: PerformanceMetrics | null;
  tokenStats?: TokenStats;
  events?: LogLine[];
}

export interface TokenStats {
  prompt: number;
  completion: number;
  total: number;
  calls?: number;
  peakPrompt?: number;
  peakCompletion?: number;
  peakTotal?: number;
  last?: {
    prompt: number;
    completion: number;
    total: number;
    provider?: string | null;
    model?: string | null;
    at?: string;
  } | null;
}

export type AgentName =
  | 'architect'
  | 'coder'
  | 'qa'
  | 'security'
  | 'debugger'
  | 'healer'
  | 'devops'
  | 'human'
  | 'userFix'
  | 'reporter';
export type LlmProvider = 'gemini' | 'claude' | 'openai' | 'ollama';
export type AgentState = 'idle' | 'active' | 'success' | 'failed' | 'skipped';
export type PipelineMode = 'forge' | 'validate';
export type DeployEnvironment = 'local' | 'staging';
export type WorkspaceTab =
  | 'terminal'
  | 'code'
  | 'security'
  | 'diagnosis'
  | 'metrics'
  | 'adrs'
  | 'history'
  | 'projects'
  | 'team';
