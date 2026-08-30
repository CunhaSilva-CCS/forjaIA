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

export interface ApiContract {
  method: string;
  path: string;
  description: string;
  auth?: string | boolean;
  request?: unknown;
  response?: unknown;
}

export interface DataModelField {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface DataModel {
  name: string;
  description?: string;
  fields: DataModelField[];
}

export interface PlanDependency {
  name: string;
  version?: string;
  reason?: string;
}

export interface NonFunctionalRequirement {
  area: string;
  requirement: string;
}

export interface TestScenario {
  name: string;
  method: string;
  path: string;
  body?: unknown;
  auth?: boolean;
  expectedStatus?: string;
  expect?: string;
  captureAs?: string;
}

export interface ArchitectSeniorReview {
  verdict?: string;
  summary?: string;
  risks?: string[];
}

export interface ArchitectPlan {
  files: Array<{ name: string; path: string; purpose?: string }>;
  adrs: ADR[];
  apiContracts: ApiContract[];
  dataModels: DataModel[];
  dependencies: PlanDependency[];
  nonFunctional: NonFunctionalRequirement[];
  testScenarios: TestScenario[];
  seniorReview?: ArchitectSeniorReview;
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
  latency?: number;
  loss?: number;
  log: string;
  /** true quando o fault foi aplicado de verdade no container (tc netem/cota de CPU), não simulado. */
  real?: boolean;
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

/** Evento de log bruto como vem do backend (run_events), antes de normalizado em LogLine. */
export interface RunEvent {
  agent?: string;
  message: string;
  type: string;
  created_at: string;
}

export interface TaskConfig {
  mode?: PipelineMode;
  pendingNextStage?: string;
  targetPath?: string;
  sourcePath?: string;
  healingAttempts?: number;
  llmProvider?: LlmProvider;
  useOllama?: boolean;
  lastDiagnosis?: Diagnosis;
  lastUserReport?: string | null;
}

/** Snapshot do orchestrator.currentTask — recebido via WebSocket e /api/agent/status. */
export interface Task {
  id?: string;
  status?: string;
  pendingNextStage?: string | null;
  approvalMessage?: string | null;
  config?: TaskConfig;
  prompt?: string;
  files?: FileData[];
  adrs?: ADR[];
  plan?: ArchitectPlan | null;
  tests?: TestItem[];
  securityIssues?: SecurityIssue[];
  diagnosis?: Diagnosis | null;
  performanceMetrics?: PerformanceMetrics | null;
  deployUrl?: string | null;
  tokenStats?: TokenStats;
  error?: string | null;
  humanReport?: HumanReport | null;
}

export interface HumanReport {
  passed?: boolean;
  issues?: unknown[];
  session?: { steps?: Array<{ ok: boolean }> };
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
  plan?: ArchitectPlan | null;
  tests?: TestItem[];
  securityIssues?: SecurityIssue[];
  performanceMetrics?: PerformanceMetrics | null;
  tokenStats?: TokenStats;
  events?: RunEvent[];
  config?: TaskConfig;
  diagnosis?: Diagnosis | null;
}

export interface AuditFinding {
  id: string;
  severity: string;
  title: string;
  file?: string;
  line?: number | null;
  description?: string;
}

export interface AuditRun {
  id: string;
  target: 'self' | 'project';
  targetPath: string | null;
  status: 'running' | 'completed' | 'failed';
  findings: AuditFinding[];
  tools: Record<string, { available: boolean; skippedReason?: string; error?: string }>;
  summary: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DogfoodStatus {
  scheduled: boolean;
  cronLine: string | null;
  lastRun: {
    startedAt: string | null;
    finishedAt: string | null;
    outcome: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'no-task' | null;
    runId: string | null;
    testsPassed: number | null;
    testsTotal: number | null;
  } | null;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  tokenHint?: string;
  active?: boolean;
  createdAt?: string | null;
}

export interface TeamBoardRun {
  id: string;
  queue_position?: number | null;
  owner_name?: string | null;
  prompt?: string;
  config?: TaskConfig;
}

export interface TeamBoard {
  queued: TeamBoardRun[];
  awaiting: TeamBoardRun[];
  recent: TeamBoardRun[];
}

export interface TeamInfo {
  admin: { id: string; name: string; role: string; tokenHint: string };
  members: TeamMember[];
  bootstrapTokens: Record<string, string> | null;
  stageRoles: Record<string, string[]>;
}

export interface TokenStats {
  prompt: number;
  completion: number;
  total: number;
  calls?: number;
  peakPrompt?: number;
  peakCompletion?: number;
  peakTotal?: number;
  estimatedCostUsd?: number;
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
export type LlmProvider = 'gemini' | 'claude' | 'openai' | 'ollama' | 'cursor';
export type AgentState = 'idle' | 'active' | 'success' | 'failed' | 'skipped';
export type PipelineMode = 'forge' | 'validate';
export type DeployEnvironment = 'local' | 'staging';
export type WorkspaceTab =
  | 'terminal'
  | 'code'
  | 'security'
  | 'diagnosis'
  | 'metrics'
  | 'tokens'
  | 'adrs'
  | 'architecture'
  | 'history'
  | 'projects'
  | 'team'
  | 'audit';
