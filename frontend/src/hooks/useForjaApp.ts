import confetti from 'canvas-confetti';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { connectAgentSocket } from '../services/ws';
import type {
  ADR,
  AgentName,
  AgentState,
  ChaosEvent,
  Diagnosis,
  FileData,
  LlmProvider,
  LogLine,
  PerformanceMetrics,
  PipelineMode,
  Project,
  RunSummary,
  SecurityIssue,
  TestItem,
  TokenStats,
  WorkspaceTab,
  DeployEnvironment
} from '../types/agent';

const emptyTokenStats = (): TokenStats => ({
  prompt: 0,
  completion: 0,
  total: 0,
  calls: 0,
  peakPrompt: 0,
  peakCompletion: 0,
  peakTotal: 0,
  last: null
});
const STAGE_BUTTON: Record<string, string> = {
  coder: 'Aprovar e Codificar',
  qa: 'Aprovar e Executar QA',
  security: 'Aprovar e Executar Segurança',
  debugger: 'Aprovar Depurador Sênior',
  healer: 'Aprovar e Curar',
  devops: 'Aprovar Carga/Caos',
  deploy: 'Aprovar Deploy',
  human: 'Aprovar Teste Humano In Loco',
  userFix: 'Aprovar Correção do Usuário',
  prodReady: 'Aprovar Checklist de Produção',
  report: 'Aprovar Relatório PDF'
};

const idleAgents = (): Record<AgentName, AgentState> => ({
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

export function useForjaApp() {
  const [toast, setToast] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(
    'Criar uma API de Autenticação com JWT e banco de dados relacional de usuários'
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [agentStates, setAgentStates] = useState(idleAgents());
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [files, setFiles] = useState<FileData[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [adrs, setAdrs] = useState<ADR[]>([]);
  const [tests, setTests] = useState<TestItem[]>([]);
  const [securityIssues, setSecurityIssues] = useState<SecurityIssue[]>([]);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);
  const [chaosEvents, setChaosEvents] = useState<ChaosEvent[]>([]);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<WorkspaceTab>('terminal');
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [pendingNextStage, setPendingNextStage] = useState<string | null>(null);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('gemini');
  const [useOllama, setUseOllama] = useState(false);
  const [ollamaModel, setOllamaModel] = useState('qwen2.5-coder:7b');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openaiModel, setOpenaiModel] = useState('gpt-4.1');
  const [claudeModel, setClaudeModel] = useState('claude-sonnet-4-20250514');
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [hasOpenAIKey, setHasOpenAIKey] = useState(false);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [geminiModel, setGeminiModel] = useState('gemini-3.6-flash');
  const [llmProbe, setLlmProbe] = useState<{
    provider: string;
    model: string | null;
    ok: boolean;
    configured: boolean;
    latencyMs: number;
    detail: string;
  } | null>(null);
  const [llmProbeLoading, setLlmProbeLoading] = useState(false);
  const [ollamaOnline, setOllamaOnline] = useState(false);
  const [dockerActive, setDockerActive] = useState(false);
  const [styleRules, setStyleRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState('');
  const [targetPath, setTargetPath] = useState('deployed');
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [currentBrowserPath, setCurrentBrowserPath] = useState('.');
  const [parentBrowserPath, setParentBrowserPath] = useState<string | null>(null);
  const [browserDirs, setBrowserDirs] = useState<{ name: string; path: string }[]>([]);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [browserExists, setBrowserExists] = useState(true);
  const [browserListingPath, setBrowserListingPath] = useState('.');
  const [newFolderName, setNewFolderName] = useState('');
  const [browserLoading, setBrowserLoading] = useState(false);
  const [tokenStats, setTokenStats] = useState<TokenStats>(emptyTokenStats());
  const [tokenQuota] = useState(500000);
  const [wsConnected, setWsConnected] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('projects/app');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [activeRunTargetPath, setActiveRunTargetPath] = useState<string | null>(null);
  const [fileVersions, setFileVersions] = useState<Array<{ version: number; content: string }>>([]);
  const [showDiff, setShowDiff] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('forge');
  const [userErrorReport, setUserErrorReport] = useState('');
  const [environment, setEnvironment] = useState<DeployEnvironment>('local');
  const [teamMe, setTeamMe] = useState<{ id: string; name: string; role: string; isAdmin?: boolean } | null>(
    null
  );
  const [teamBoard, setTeamBoard] = useState<{ queued: any[]; awaiting: any[]; recent: any[] }>({
    queued: [],
    awaiting: [],
    recent: []
  });
  const [teamInfo, setTeamInfo] = useState<any>(null);
  const [serviceStatus, setServiceStatus] = useState<{
    online: boolean;
    host: string;
    port: number;
    pids: number[];
    watch: { enabled: boolean; pid: number | null };
    control?: { watchRunning: boolean; mode: string };
  } | null>(null);
  const [serviceBusy, setServiceBusy] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const didAutoSelectProject = useRef(false);
  const didApplyDefaultProvider = useRef(false);
  const selectedFilePathRef = useRef<string | null>(null);
  const handleWsMessageRef = useRef<(event: string, data: any) => void>(() => undefined);

  useEffect(() => {
    selectedFilePathRef.current = selectedFilePath;
  }, [selectedFilePath]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const deriveAgentStates = useCallback((task: any): Record<AgentName, AgentState> => {
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
      next.qa = task.tests.every((t: TestItem) => t.passed) ? 'success' : 'failed';
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
  }, []);

  const refreshMeta = useCallback(async () => {
    try {
      const [docker, ollama, prefs, workspace, projectList, runList, health, me, team, board] =
        await Promise.all([
          api.dockerStatus(),
          api.ollamaModels(),
          api.preferences.get(),
          api.workspace(),
          api.projects.list(),
          api.runs.list(),
          api.health(),
          api.team.me().catch(() => null),
          api.team.list().catch(() => null),
          api.team.board().catch(() => null)
        ]);
      setDockerActive(docker.active);
      setOllamaOnline(ollama.online);
      setOllamaModels(ollama.models);
      if (ollama.models.length && !ollama.models.includes(ollamaModel)) {
        setOllamaModel(ollama.models[0]);
      }
      setHasGeminiKey(Boolean(health.hasGeminiKey));
      setHasOpenAIKey(Boolean(health.hasOpenAIKey));
      setHasAnthropicKey(Boolean(health.hasAnthropicKey));
      const llm = health.llm as
        | {
            default?: string;
            gemini?: { model?: string };
            openai?: { model?: string };
            claude?: { model?: string };
            ollama?: { model?: string };
          }
        | undefined;
      if (llm?.gemini?.model) setGeminiModel(llm.gemini.model);
      if (llm?.openai?.model) setOpenaiModel(llm.openai.model);
      if (llm?.claude?.model) setClaudeModel(llm.claude.model);
      if (llm?.ollama?.model && !ollama.models.length) setOllamaModel(llm.ollama.model);
      const defaultProvider = llm?.default;
      if (
        !didApplyDefaultProvider.current &&
        (defaultProvider === 'gemini' ||
          defaultProvider === 'claude' ||
          defaultProvider === 'openai' ||
          defaultProvider === 'ollama')
      ) {
        didApplyDefaultProvider.current = true;
        setLlmProvider(defaultProvider);
        setUseOllama(defaultProvider === 'ollama');
      }
      setStyleRules(prefs.styleRules || []);
      setWorkspaceRoot(workspace.workspaceRoot);
      setProjects(projectList);
      setRuns(runList);
      if (me) setTeamMe(me);
      if (team) setTeamInfo(team);
      if (board) setTeamBoard(board);
      if (!didAutoSelectProject.current && projectList.length) {
        didAutoSelectProject.current = true;
        const preferred =
          projectList.find((p) => p.path === 'rag-profissional') ||
          projectList.find((p) => p.source === 'workspace') ||
          projectList[0];
        if (preferred) {
          void (async () => {
            try {
              if (preferred.source === 'workspace' || String(preferred.id).startsWith('ws:')) {
                const ensured = await api.projects.ensure(preferred.name, preferred.path);
                setSelectedProjectId(ensured.id);
                setTargetPath(ensured.path);
                setProjects((prev) => {
                  const without = prev.filter((p) => p.path !== ensured.path);
                  return [{ ...ensured, source: 'registered', existsOnDisk: true }, ...without];
                });
              } else {
                setSelectedProjectId(preferred.id);
                setTargetPath(preferred.path);
              }
            } catch {
              setSelectedProjectId(preferred.id);
              setTargetPath(preferred.path);
            }
          })();
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao carregar metadados');
    }
  }, [ollamaModel, showToast]);

  const applyTask = useCallback((task: any) => {
    if (!task) return;
    setCurrentRunId(task.id || null);
    setTaskStatus(task.status);
    setPendingNextStage(task.pendingNextStage || task.config?.pendingNextStage || null);
    setApprovalMessage(task.approvalMessage || null);
    setFiles(task.files || []);
    setAdrs(task.adrs || []);
    setTests(task.tests || []);
    setSecurityIssues(task.securityIssues || []);
    setDiagnosis(task.diagnosis || task.config?.lastDiagnosis || null);
    setPerformanceMetrics(task.performanceMetrics || null);
    setDeployUrl(task.deployUrl || null);
    const mode = task.config?.mode === 'validate' ? 'validate' : 'forge';
    setPipelineMode(mode);
    if (task.prompt) setPrompt(task.prompt);
    const tp =
      task.config?.mode === 'validate'
        ? task.config?.sourcePath || task.config?.targetPath
        : task.config?.targetPath || task.config?.sourcePath;
    if (tp) {
      setTargetPath(tp);
      setActiveRunTargetPath(tp);
      const match = projects.find((p) => p.path === tp);
      if (match) setSelectedProjectId(match.id);
    }
    if (task.config?.llmProvider) {
      const p = task.config.llmProvider as 'gemini' | 'claude' | 'openai' | 'ollama';
      setLlmProvider(p);
      setUseOllama(p === 'ollama' || Boolean(task.config.useOllama));
    }
    if (task.tokenStats) setTokenStats({ ...emptyTokenStats(), ...task.tokenStats });
    const paths = (task.files || []).map((f: FileData) => f.path);
    const current = selectedFilePathRef.current;
    if (paths.length) {
      if (!current || !paths.includes(current)) {
        setSelectedFilePath(paths[0]);
      }
    } else {
      setSelectedFilePath(null);
    }
  }, [projects]);

  const handleWsMessage = useCallback(
    (event: string, data: any) => {
      switch (event) {
        case 'sync-state':
          setIsExecuting(data.isExecuting);
          applyTask(data.task);
          if (data.task) {
            setAgentStates(deriveAgentStates(data.task));
            setActiveAgent(null);
            if (data.task.id) {
              api.runs
                .get(data.task.id)
                .then((run) => {
                  setLogs(
                    (run.events || []).map((e: any) => ({
                      agent: e.agent || 'system',
                      message: e.message,
                      type: e.type,
                      timestamp: e.created_at
                    }))
                  );
                })
                .catch(() => undefined);
            }
          }
          break;
        case 'task-started': {
          setIsExecuting(true);
          setTaskStatus(data.status || 'planning');
          setCurrentRunId(data.id || null);
          setPipelineMode(data.config?.mode === 'validate' ? 'validate' : 'forge');
          setLogs([]);
          setPendingNextStage(null);
          setApprovalMessage(null);
          setSelectedFilePath(null);
          setActiveAgent(null);
          const seededFiles = Array.isArray(data.files) ? data.files : [];
          const seededAdrs = Array.isArray(data.adrs) ? data.adrs : [];
          setFiles(seededFiles);
          setAdrs(seededAdrs);
          setTests([]);
          setSecurityIssues([]);
          setDiagnosis(null);
          setPerformanceMetrics(null);
          setChaosEvents([]);
          setDeployUrl(null);
          setTokenStats(emptyTokenStats());
          setAgentStates(
            data.config?.mode === 'validate'
              ? { ...idleAgents(), architect: 'skipped', coder: 'skipped' }
              : idleAgents()
          );
          setFileVersions([]);
          if (seededFiles[0]?.path) setSelectedFilePath(seededFiles[0].path);
          break;
        }
        case 'tokens-updated':
          setTokenStats({
            ...emptyTokenStats(),
            ...data,
            last: data?.last ?? null
          });
          break;
        case 'agent-active':
          setActiveAgent(data.agent);
          setAgentStates((prev) => ({ ...prev, [data.agent]: 'active' }));
          break;
        case 'agent-finished':
          setActiveAgent(null);
          setAgentStates((prev) => ({ ...prev, [data.agent]: data.status }));
          if (data.agent === 'architect' && data.status !== 'skipped' && data.data) {
            setAdrs(data.data.adrs || []);
            setFiles((data.data.files || []).map((f: any) => ({ name: f.name, path: f.path, content: '' })));
            if (data.data.files?.[0]) setSelectedFilePath(data.data.files[0].path);
          }
          if (data.agent === 'coder' && data.status !== 'skipped' && data.data) {
            setFiles(data.data.files || []);
          }
          if (data.agent === 'healer' && data.status === 'success' && Array.isArray(data.data)) {
            setFiles(data.data);
          }
          if (data.agent === 'userFix' && data.status === 'success' && Array.isArray(data.data)) {
            setFiles(data.data);
          }
          if (data.agent === 'qa' && data.data) setTests(data.data.tests || []);
          if (data.agent === 'security' && data.data) setSecurityIssues(data.data.issues || []);
          if (data.agent === 'debugger' && data.data && data.status !== 'skipped') {
            setDiagnosis(data.data);
            setCurrentTab('diagnosis');
          }
          break;
        case 'diagnosis-updated':
          setDiagnosis(data);
          break;
        case 'agent-log':
          setLogs((prev) => [...prev, data]);
          break;
        case 'task-awaiting-approval':
          setIsExecuting(false);
          setTaskStatus('awaiting_approval');
          setPendingNextStage(data.pendingNextStage || null);
          setApprovalMessage(data.approvalMessage || null);
          setActiveAgent(null);
          applyTask(data);
          setAgentStates((prev) => {
            const derived = deriveAgentStates(data);
            return { ...prev, ...derived, devops: data.deployUrl ? 'success' : prev.devops };
          });
          break;
        case 'task-resumed':
          setIsExecuting(true);
          setTaskStatus(data.status);
          break;
        case 'chaos-injected':
          setChaosEvents((prev) => [data, ...prev]);
          break;
        case 'metrics-updated':
          setPerformanceMetrics(data);
          break;
        case 'task-completed':
          setIsExecuting(false);
          setTaskStatus('completed');
          setActiveAgent(null);
          setPendingNextStage(null);
          setApprovalMessage(null);
          applyTask(data);
          setAgentStates(deriveAgentStates({ ...data, status: 'completed' }));
          confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
          api.runs.list().then(setRuns).catch(() => undefined);
          break;
        case 'task-failed':
        case 'task-cancelled':
          setIsExecuting(false);
          setTaskStatus(data.status || (event === 'task-cancelled' ? 'cancelled' : 'failed'));
          setActiveAgent(null);
          setPendingNextStage(null);
          setApprovalMessage(null);
          applyTask(data);
          if (data.error) showToast(data.error);
          api.runs.list().then(setRuns).catch(() => undefined);
          break;
      }
    },
    [applyTask, deriveAgentStates, showToast]
  );

  useEffect(() => {
    handleWsMessageRef.current = handleWsMessage;
  }, [handleWsMessage]);

  const browseTo = useCallback(async (pathString: string) => {
    setBrowserLoading(true);
    setBrowserError(null);
    try {
      const data = await api.browse(pathString || '.');
      setCurrentBrowserPath(data.currentPath);
      setParentBrowserPath(data.parentPath);
      setBrowserDirs(data.directories || []);
      setBrowserExists(data.exists !== false);
      setBrowserListingPath(data.listingPath || data.currentPath);
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : 'Falha ao listar pasta');
    } finally {
      setBrowserLoading(false);
    }
  }, []);

  const openFolderBrowser = useCallback(() => {
    const start = targetPath?.trim() || '.';
    setShowFolderBrowser(true);
    setNewFolderName('');
    void browseTo(start);
  }, [browseTo, targetPath]);

  const createBrowserFolder = useCallback(async () => {
    const name = newFolderName.trim().replace(/^\/+|\/+$/g, '');
    if (!name) return;
    const base = currentBrowserPath === '.' ? '' : currentBrowserPath;
    const full = base ? `${base}/${name}` : name;
    setBrowserLoading(true);
    setBrowserError(null);
    try {
      const data = await api.mkdir(full);
      setNewFolderName('');
      setCurrentBrowserPath(data.currentPath);
      setParentBrowserPath(data.parentPath);
      setBrowserDirs(data.directories || []);
      setBrowserExists(true);
      setBrowserListingPath(data.currentPath);
      showToast(`Pasta criada: ${data.currentPath}`);
    } catch (err) {
      setBrowserError(err instanceof Error ? err.message : 'Falha ao criar pasta');
    } finally {
      setBrowserLoading(false);
    }
  }, [currentBrowserPath, newFolderName, showToast]);

  useEffect(() => {
    void refreshMeta();
    const disconnect = connectAgentSocket(
      (event, data) => handleWsMessageRef.current(event, data),
      setWsConnected
    );
    return disconnect;
    // Connect once; handlers via ref. refreshMeta on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshLlmProbe = useCallback(async (provider?: LlmProvider) => {
    setLlmProbeLoading(true);
    try {
      const status = await api.llmStatus(provider || llmProvider);
      setLlmProbe(status);
    } catch (err) {
      setLlmProbe({
        provider: provider || llmProvider,
        model: null,
        ok: false,
        configured: false,
        latencyMs: 0,
        detail: err instanceof Error ? err.message : 'Falha ao verificar modelo'
      });
    } finally {
      setLlmProbeLoading(false);
    }
  }, [llmProvider]);

  useEffect(() => {
    void refreshLlmProbe(llmProvider);
  }, [llmProvider, refreshLlmProbe]);

  // removed auto-browse effect that looped on currentBrowserPath
  const runConfig = () => ({
    llmProvider,
    useOllama: llmProvider === 'ollama',
    ollamaModel,
    openaiModel,
    claudeModel,
    geminiModel,
    // Em run ativo, priorizar caminho do run (evita projeto stale na UI)
    targetPath: activeRunTargetPath || targetPath,
    projectId: selectedProjectId,
    environment,
    mode: pipelineMode
  });

  const approveButtonLabel =
    (pendingNextStage && STAGE_BUTTON[pendingNextStage]) || 'Aprovar e Continuar';

  const refreshTeamBoard = async () => {
    try {
      const board = await api.team.board();
      setTeamBoard(board);
    } catch {
      // ignore
    }
  };

  const refreshServiceStatus = useCallback(async () => {
    try {
      const st = await api.services.status();
      setServiceStatus(st);
    } catch {
      setServiceStatus(null);
    }
  }, []);

  const runServiceAction = useCallback(
    async (action: 'start' | 'stop' | 'restart' | 'watch') => {
      setServiceBusy(true);
      try {
        const res = await api.services.action(action);
        showToast(res.message || `Ação ${action} enviada`);
        if (action === 'restart' || action === 'stop') {
          showToast('Aguarde o serviço voltar…');
          setTimeout(() => {
            void refreshServiceStatus();
            void refreshMeta();
          }, 5000);
        } else {
          await refreshServiceStatus();
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : `Falha em ${action}`);
      } finally {
        setServiceBusy(false);
      }
    },
    [refreshMeta, refreshServiceStatus, showToast]
  );

  useEffect(() => {
    void refreshServiceStatus();
    const id = window.setInterval(() => void refreshServiceStatus(), 15000);
    return () => window.clearInterval(id);
  }, [refreshServiceStatus]);

  const handleRun = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    setPipelineMode('forge');
    setCurrentTab('terminal');
    try {
      const res: any = await api.run(prompt, { ...runConfig(), mode: 'forge' });
      if (res?.queued) {
        setIsExecuting(false);
        showToast(res.message || 'Run enfileirado');
        await refreshTeamBoard();
      }
    } catch (err) {
      setIsExecuting(false);
      showToast(err instanceof Error ? err.message : 'Falha ao iniciar');
    }
  };

  const handleValidateExisting = async () => {
    if (isExecuting) return;
    const source = targetPath?.trim();
    if (!source || source === '.') {
      showToast('Informe o caminho do projeto pronto no workspace (ex: rag-profissional)');
      return;
    }
    setIsExecuting(true);
    setPipelineMode('validate');
    setCurrentTab('terminal');
    try {
      // Evita projectId virtual ws:… que quebrava FK e deixava a UI “travada”
      let projectId = selectedProjectId;
      if (!projectId || String(projectId).startsWith('ws:')) {
        const name = source.split('/').filter(Boolean).pop() || source;
        const ensured = await api.projects.ensure(name, source);
        projectId = ensured.id;
        setSelectedProjectId(ensured.id);
      }
      const res: any = await api.validate(source, { ...runConfig(), mode: 'validate', projectId });
      if (res?.queued) {
        setIsExecuting(false);
        showToast(res.message || 'Validação enfileirada');
        await refreshTeamBoard();
      } else {
        showToast(`Validando projeto pronto: ${source}`);
      }
    } catch (err) {
      setIsExecuting(false);
      showToast(err instanceof Error ? err.message : 'Falha ao validar');
    }
  };

  const handleApprove = async () => {
    setIsExecuting(true);
    setTaskStatus(pendingNextStage || 'coding');
    setCurrentTab('terminal');
    try {
      const planPatch =
        pendingNextStage === 'coder'
          ? { adrs, files: files.map((f) => ({ name: f.name, path: f.path })) }
          : undefined;
      await api.approve(runConfig(), planPatch);
    } catch (err) {
      setIsExecuting(false);
      setTaskStatus('awaiting_approval');
      showToast(err instanceof Error ? err.message : 'Falha ao aprovar');
    }
  };

  const handleCancel = async () => {
    try {
      await api.cancel();
      showToast('Cancelamento solicitado');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao cancelar');
    }
  };

  const handleUserReport = async () => {
    const message = userErrorReport.trim();
    if (!message) {
      showToast('Descreva o erro visto na tela');
      return;
    }
    try {
      const result = await api.userReport(message);
      setUserErrorReport('');
      setTaskStatus('awaiting_approval');
      setPendingNextStage(result.nextStage || 'userFix');
      setApprovalMessage(result.message || null);
      setAgentStates((prev) => ({ ...prev, userFix: 'active' }));
      showToast('Relato enfileirado — aprove o Corretor do Usuário');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao enviar relato');
    }
  };

  const saveRules = async (updated: string[]) => {
    setStyleRules(updated);
    try {
      await api.preferences.set(updated);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao salvar preferências');
    }
  };

  const openRun = async (id: string) => {
    try {
      const run = await api.runs.get(id);
      setCurrentRunId(run.id);
      setPrompt(run.prompt);
      setTaskStatus(run.status);
      setFiles(run.files || []);
      setAdrs(run.adrs || []);
      setTests(run.tests || []);
      setSecurityIssues(run.securityIssues || []);
      setDiagnosis((run as any).config?.lastDiagnosis || (run as any).diagnosis || null);
      setPerformanceMetrics(run.performanceMetrics || null);
      setDeployUrl(run.deploy_url || null);
      setLogs(
        (run.events || []).map((e: any) => ({
          agent: e.agent || 'system',
          message: e.message,
          type: e.type,
          timestamp: e.created_at
        }))
      );
      setTokenStats(run.tokenStats ? { ...emptyTokenStats(), ...run.tokenStats } : emptyTokenStats());
      setCurrentTab('terminal');
      showToast(`Execução ${id} carregada`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao abrir execução');
    }
  };

  const loadDiff = async () => {
    if (!currentRunId || !selectedFilePath) return;
    try {
      const versions = await api.runs.fileVersions(currentRunId, selectedFilePath);
      setFileVersions(versions.map((v) => ({ version: v.version, content: v.content })));
      setShowDiff(versions.length >= 2);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sem versões para comparar');
      setShowDiff(false);
    }
  };

  const selectProject = useCallback(
    async (id: string | null) => {
      setSelectedProjectId(id);
      if (!id) return;
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      setTargetPath(project.path);
      if (project.source === 'workspace' || String(project.id).startsWith('ws:')) {
        try {
          const ensured = await api.projects.ensure(project.name, project.path);
          setSelectedProjectId(ensured.id);
          setProjects((prev) => {
            const without = prev.filter((p) => p.path !== ensured.path);
            return [{ ...ensured, source: 'registered', existsOnDisk: true }, ...without];
          });
        } catch {
          // pasta do workspace ainda pode ser usada sem registro
        }
      }
    },
    [projects]
  );

  const createProject = async () => {
    try {
      const project = await api.projects.create(newProjectName.trim(), newProjectPath.trim());
      setProjects((prev) => [{ ...project, source: 'registered', existsOnDisk: true }, ...prev.filter((p) => p.path !== project.path)]);
      setSelectedProjectId(project.id);
      setTargetPath(project.path);
      setNewProjectName('');
      showToast('Projeto criado');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao criar projeto');
    }
  };

  return {
    toast,
    showToast,
    prompt,
    setPrompt,
    isExecuting,
    activeAgent,
    agentStates,
    logs,
    files,
    selectedFilePath,
    setSelectedFilePath,
    adrs,
    setAdrs,
    tests,
    securityIssues,
    diagnosis,
    performanceMetrics,
    chaosEvents,
    deployUrl,
    currentTab,
    setCurrentTab,
    taskStatus,
    pipelineMode,
    environment,
    setEnvironment,
    teamMe,
    teamInfo,
    teamBoard,
    refreshTeamBoard,
    serviceStatus,
    serviceBusy,
    refreshServiceStatus,
    runServiceAction,
    pendingNextStage,
    approvalMessage,
    approveButtonLabel,
    llmProvider,
    setLlmProvider,
    useOllama,
    setUseOllama,
    ollamaModel,
    setOllamaModel,
    ollamaModels,
    openaiModel,
    setOpenaiModel,
    claudeModel,
    setClaudeModel,
    geminiModel,
    llmProbe,
    llmProbeLoading,
    refreshLlmProbe,
    ollamaOnline,
    hasGeminiKey,
    hasOpenAIKey,
    hasAnthropicKey,
    dockerActive,
    styleRules,
    setStyleRules,
    newRule,
    setNewRule,
    targetPath,
    setTargetPath,
    showFolderBrowser,
    setShowFolderBrowser,
    openFolderBrowser,
    browseTo,
    createBrowserFolder,
    currentBrowserPath,
    setCurrentBrowserPath,
    parentBrowserPath,
    browserDirs,
    browserError,
    browserExists,
    browserListingPath,
    browserLoading,
    newFolderName,
    setNewFolderName,
    tokenStats,
    tokenQuota,
    wsConnected,
    projects,
    selectedProjectId,
    setSelectedProjectId,
    selectProject,
    newProjectName,
    setNewProjectName,
    newProjectPath,
    setNewProjectPath,
    runs,
    currentRunId,
    fileVersions,
    showDiff,
    setShowDiff,
    workspaceRoot,
    logsEndRef,
    handleRun,
    handleValidateExisting,
    handleApprove,
    handleCancel,
    handleUserReport,
    userErrorReport,
    setUserErrorReport,
    saveRules,
    openRun,
    loadDiff,
    createProject,
    refreshMeta
  };
}
