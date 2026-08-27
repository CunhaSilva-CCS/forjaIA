import confetti from 'canvas-confetti';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { connectAgentSocket } from '../services/ws';
import { deriveAgentStates, idleAgents } from '../utils/deriveAgentStates';
import { useFolderBrowser } from './useFolderBrowser';
import { useServiceControl } from './useServiceControl';
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
  Task,
  TeamBoard,
  TeamInfo,
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
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);
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
  const [healingAttempts, setHealingAttempts] = useState(0);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('gemini');
  const [useOllama, setUseOllama] = useState(false);
  const [ollamaModel, setOllamaModel] = useState('qwen2.5-coder:7b');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openaiModel, setOpenaiModel] = useState('gpt-4.1');
  const [claudeModel, setClaudeModel] = useState('claude-sonnet-4-20250514');
  const [cursorModel, setCursorModel] = useState('auto');
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
  const [cursorOnline, setCursorOnline] = useState(false);
  const [styleRules, setStyleRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState('');
  const [targetPath, setTargetPath] = useState('deployed');
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
  const [teamBoard, setTeamBoard] = useState<TeamBoard>({
    queued: [],
    awaiting: [],
    recent: []
  });
  const [teamInfo, setTeamInfo] = useState<TeamInfo | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const didAutoSelectProject = useRef(false);
  const didApplyDefaultProvider = useRef(false);
  const selectedFilePathRef = useRef<string | null>(null);
  const handleWsMessageRef = useRef<(event: string, data: unknown) => void>(() => undefined);

  useEffect(() => {
    selectedFilePathRef.current = selectedFilePath;
  }, [selectedFilePath]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const folderBrowser = useFolderBrowser(targetPath, showToast);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const refreshMeta = useCallback(async () => {
    try {
      const [docker, ollama, prefs, workspace, projectList, runList, health, me, team, board, cursor] =
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
          api.team.board().catch(() => null),
          api.llmStatus('cursor').catch(() => null)
        ]);
      setDockerActive(docker.active);
      setOllamaOnline(ollama.online);
      setCursorOnline(Boolean(cursor?.ok));
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

  const applyTask = useCallback((task: Task | null | undefined) => {
    if (!task) return;
    setCurrentRunId(task.id || null);
    setTaskStatus(task.status ?? null);
    setPendingNextStage(task.pendingNextStage || task.config?.pendingNextStage || null);
    setApprovalMessage(task.approvalMessage || null);
    setHealingAttempts(task.config?.healingAttempts || 0);
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
      // Só trava o destino enquanto a run ainda está em andamento — uma task terminal
      // (completed/failed/cancelled) sincronizada via sync-state (ex: após reload da página)
      // não deve prender o campo Destino, senão a PRÓXIMA run herda o caminho da anterior.
      const isTerminal = TERMINAL_TASK_STATUSES.has(task.status || '');
      setActiveRunTargetPath(isTerminal ? null : tp);
      const match = projects.find((p) => p.path === tp);
      if (match) setSelectedProjectId(match.id);
    }
    if (task.config?.llmProvider) {
      const p = task.config.llmProvider;
      setLlmProvider(p);
      setUseOllama(p === 'ollama' || Boolean(task.config.useOllama));
    }
    if (task.tokenStats) setTokenStats({ ...emptyTokenStats(), ...task.tokenStats });
    const paths = (task.files || []).map((f) => f.path);
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
    (event: string, data: unknown) => {
      switch (event) {
        case 'sync-state': {
          const payload = data as { isExecuting: boolean; task: Task | null };
          setIsExecuting(payload.isExecuting);
          applyTask(payload.task);
          if (payload.task) {
            setAgentStates(deriveAgentStates(payload.task));
            setActiveAgent(null);
            if (payload.task.id) {
              api.runs
                .get(payload.task.id)
                .then((run) => {
                  setLogs(
                    (run.events || []).map((e) => ({
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
        }
        case 'task-started': {
          const payload = data as Task;
          setIsExecuting(true);
          setTaskStatus(payload.status || 'planning');
          setCurrentRunId(payload.id || null);
          setPipelineMode(payload.config?.mode === 'validate' ? 'validate' : 'forge');
          setLogs([]);
          setPendingNextStage(null);
          setApprovalMessage(null);
          setHealingAttempts(0);
          setSelectedFilePath(null);
          setActiveAgent(null);
          const seededFiles = Array.isArray(payload.files) ? payload.files : [];
          const seededAdrs = Array.isArray(payload.adrs) ? payload.adrs : [];
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
            payload.config?.mode === 'validate'
              ? { ...idleAgents(), architect: 'skipped', coder: 'skipped' }
              : idleAgents()
          );
          setFileVersions([]);
          if (seededFiles[0]?.path) setSelectedFilePath(seededFiles[0].path);
          break;
        }
        case 'tokens-updated': {
          const payload = data as TokenStats;
          setTokenStats({
            ...emptyTokenStats(),
            ...payload,
            last: payload?.last ?? null
          });
          break;
        }
        case 'agent-active': {
          const payload = data as { agent: AgentName };
          setActiveAgent(payload.agent);
          setAgentStates((prev) => ({ ...prev, [payload.agent]: 'active' }));
          break;
        }
        case 'agent-finished': {
          const payload = data as { agent: AgentName; status: AgentState; data?: unknown };
          setActiveAgent(null);
          setAgentStates((prev) => ({ ...prev, [payload.agent]: payload.status }));
          if (payload.agent === 'architect' && payload.status !== 'skipped' && payload.data) {
            const plan = payload.data as { adrs?: ADR[]; files?: Array<{ name: string; path: string }> };
            setAdrs(plan.adrs || []);
            setFiles((plan.files || []).map((f) => ({ name: f.name, path: f.path, content: '' })));
            if (plan.files?.[0]) setSelectedFilePath(plan.files[0].path);
          }
          if (payload.agent === 'coder' && payload.status !== 'skipped' && payload.data) {
            const codeOutput = payload.data as { files?: FileData[] };
            setFiles(codeOutput.files || []);
          }
          if (payload.agent === 'healer' && payload.status === 'success' && Array.isArray(payload.data)) {
            setFiles(payload.data as FileData[]);
          }
          if (payload.agent === 'userFix' && payload.status === 'success' && Array.isArray(payload.data)) {
            setFiles(payload.data as FileData[]);
          }
          if (payload.agent === 'qa' && payload.data) {
            setTests((payload.data as { tests?: TestItem[] }).tests || []);
          }
          if (payload.agent === 'security' && payload.data) {
            setSecurityIssues((payload.data as { issues?: SecurityIssue[] }).issues || []);
          }
          if (payload.agent === 'debugger' && payload.data && payload.status !== 'skipped') {
            setDiagnosis(payload.data as Diagnosis);
            setCurrentTab('diagnosis');
          }
          break;
        }
        case 'diagnosis-updated':
          setDiagnosis(data as Diagnosis);
          break;
        case 'agent-log':
          setLogs((prev) => [...prev, data as LogLine]);
          break;
        case 'task-awaiting-approval': {
          const payload = data as Task;
          setIsExecuting(false);
          setTaskStatus('awaiting_approval');
          setPendingNextStage(payload.pendingNextStage || null);
          setApprovalMessage(payload.approvalMessage || null);
          setActiveAgent(null);
          applyTask(payload);
          setAgentStates((prev) => {
            const derived = deriveAgentStates(payload);
            return { ...prev, ...derived, devops: payload.deployUrl ? 'success' : prev.devops };
          });
          break;
        }
        case 'task-resumed': {
          const payload = data as Task;
          setIsExecuting(true);
          setTaskStatus(payload.status ?? null);
          break;
        }
        case 'chaos-injected':
          setChaosEvents((prev) => [data as ChaosEvent, ...prev]);
          break;
        case 'metrics-updated':
          setPerformanceMetrics(data as PerformanceMetrics);
          break;
        case 'task-completed': {
          const payload = data as Task;
          setIsExecuting(false);
          setTaskStatus('completed');
          setActiveAgent(null);
          setPendingNextStage(null);
          setApprovalMessage(null);
          applyTask(payload);
          setAgentStates(deriveAgentStates({ ...payload, status: 'completed' }));
          confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
          api.runs.list().then(setRuns).catch(() => undefined);
          break;
        }
        case 'task-failed':
        case 'task-cancelled': {
          const payload = data as Task;
          setIsExecuting(false);
          setTaskStatus(payload.status || (event === 'task-cancelled' ? 'cancelled' : 'failed'));
          setActiveAgent(null);
          setPendingNextStage(null);
          setApprovalMessage(null);
          applyTask(payload);
          if (payload.error) showToast(payload.error);
          api.runs.list().then(setRuns).catch(() => undefined);
          break;
        }
      }
    },
    [applyTask, showToast]
  );

  useEffect(() => {
    handleWsMessageRef.current = handleWsMessage;
  }, [handleWsMessage]);

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
    cursorModel,
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

  const { serviceStatus, serviceBusy, refreshServiceStatus, runServiceAction } = useServiceControl(
    showToast,
    refreshMeta
  );

  const handleRun = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    setPipelineMode('forge');
    setCurrentTab('terminal');
    try {
      const res = await api.run(prompt, { ...runConfig(), mode: 'forge' });
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
      const res = await api.validate(source, { ...runConfig(), mode: 'validate', projectId });
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
      setDiagnosis(run.config?.lastDiagnosis || run.diagnosis || null);
      setPerformanceMetrics(run.performanceMetrics || null);
      setDeployUrl(run.deploy_url || null);
      setHealingAttempts(run.config?.healingAttempts || 0);
      setLogs(
        (run.events || []).map((e) => ({
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

  // O backend trava o provedor de LLM assim que uma task existe e não terminou
  // (ver orchestrator.js — "Provedor X da UI substituído pelo default do servidor").
  // Refletir isso no próprio seletor evita que o usuário troque achando que vai
  // valer e só descubra pelo log, no meio da run, que foi ignorado.
  const providerLocked = Boolean(taskStatus) && !TERMINAL_TASK_STATUSES.has(taskStatus || '');

  return {
    toast,
    showToast,
    prompt,
    setPrompt,
    isExecuting,
    activeAgent,
    agentStates,
    logs,
    healingAttempts,
    providerLocked,
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
    cursorModel,
    setCursorModel,
    geminiModel,
    llmProbe,
    llmProbeLoading,
    refreshLlmProbe,
    ollamaOnline,
    cursorOnline,
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
    ...folderBrowser,
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

export type AppState = ReturnType<typeof useForjaApp>;
