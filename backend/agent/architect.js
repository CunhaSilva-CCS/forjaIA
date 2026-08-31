const config = require('../lib/config');
const { generateJson } = require('../lib/llm');
const { composeSystemPrompt } = require('../lib/seniorEngineer');
const { normalizePlan, mergePlanAmendments, summarizePlan } = require('../lib/architectPlan');

const MOCK_TEMPLATES = {
  auth: {
    files: [
      { name: 'package.json', path: 'package.json', purpose: 'Manifesto e scripts npm' },
      { name: 'server.js', path: 'server.js', purpose: 'Entrypoint HTTP Express' },
      { name: 'db.js', path: 'db.js', purpose: 'Persistência de usuários' },
      { name: 'authController.js', path: 'controllers/authController.js', purpose: 'Registro e login' },
      { name: 'authMiddleware.js', path: 'middlewares/authMiddleware.js', purpose: 'Validação JWT' },
      { name: 'userModel.js', path: 'models/userModel.js', purpose: 'Esquema de usuário' }
    ],
    adrs: [
      {
        id: 'ADR-0001',
        title: 'JWT para autenticação sem estado',
        status: 'Proposto',
        context: 'Precisamos de autenticação escalável sem sessões no servidor.',
        decision: 'Usar JWT com HMAC SHA256 e expiração de 1h.',
        consequences: 'Fácil escala horizontal; revogação exige lista de bloqueio.'
      }
    ],
    apiContracts: [
      {
        method: 'POST',
        path: '/api/auth/register',
        description: 'Cria conta com email e senha',
        auth: false,
        request: { email: 'string', password: 'string', name: 'string' },
        response: { success: true, data: { id: 'string', email: 'string' } }
      },
      {
        method: 'POST',
        path: '/api/auth/login',
        description: 'Autentica e retorna JWT',
        auth: false,
        request: { email: 'string', password: 'string' },
        response: { success: true, data: { token: 'string' } }
      },
      {
        method: 'GET',
        path: '/api/auth/me',
        description: 'Retorna usuário autenticado',
        auth: 'Bearer JWT',
        response: { success: true, data: { id: 'string', email: 'string', name: 'string' } }
      }
    ],
    dataModels: [
      {
        name: 'User',
        description: 'Usuário da aplicação',
        fields: [
          { name: 'id', type: 'string', required: true },
          { name: 'email', type: 'string', required: true },
          { name: 'passwordHash', type: 'string', required: true },
          { name: 'name', type: 'string', required: true }
        ]
      }
    ],
    dependencies: [
      { name: 'express', version: '^4.19.2', reason: 'Servidor HTTP' },
      { name: 'jsonwebtoken', version: '^9.0.2', reason: 'Tokens JWT' },
      { name: 'bcryptjs', version: '^2.4.3', reason: 'Hash de senha' }
    ],
    nonFunctional: [
      { area: 'segurança', requirement: 'JWT_SECRET via process.env; rate limit em login/register' },
      { area: 'observabilidade', requirement: 'Healthcheck GET /health' }
    ]
  },
  crud: {
    files: [
      { name: 'package.json', path: 'package.json', purpose: 'Manifesto e scripts npm' },
      { name: 'server.js', path: 'server.js', purpose: 'Entrypoint HTTP Express' },
      { name: 'db.js', path: 'db.js', purpose: 'Persistência SQLite' },
      { name: 'taskController.js', path: 'controllers/taskController.js', purpose: 'CRUD de tarefas' },
      { name: 'taskModel.js', path: 'models/taskModel.js', purpose: 'Esquema de tarefa' }
    ],
    adrs: [
      {
        id: 'ADR-0001',
        title: 'SQLite para persistência embarcada',
        status: 'Proposto',
        context: 'Precisamos de armazenamento relacional sem operação de DB externo.',
        decision: 'Usar banco SQLite em arquivo.',
        consequences: 'Portátil; concorrência de escrita limitada.'
      }
    ],
    apiContracts: [
      {
        method: 'GET',
        path: '/api/tasks',
        description: 'Lista tarefas',
        response: { success: true, data: [{ id: 'number', title: 'string', done: 'boolean' }] }
      },
      {
        method: 'POST',
        path: '/api/tasks',
        description: 'Cria tarefa',
        request: { title: 'string' },
        response: { success: true, data: { id: 'number', title: 'string', done: false } }
      },
      {
        method: 'PUT',
        path: '/api/tasks/:id',
        description: 'Atualiza tarefa',
        request: { title: 'string', done: 'boolean' },
        response: { success: true, data: { id: 'number', title: 'string', done: 'boolean' } }
      },
      {
        method: 'DELETE',
        path: '/api/tasks/:id',
        description: 'Remove tarefa',
        response: { success: true }
      }
    ],
    dataModels: [
      {
        name: 'Task',
        fields: [
          { name: 'id', type: 'integer', required: true },
          { name: 'title', type: 'string', required: true },
          { name: 'done', type: 'boolean', required: true }
        ]
      }
    ],
    dependencies: [
      { name: 'express', version: '^4.19.2', reason: 'Servidor HTTP' },
      { name: 'better-sqlite3', version: '^11.0.0', reason: 'SQLite embarcado' }
    ],
    nonFunctional: [{ area: 'observabilidade', requirement: 'Healthcheck GET /health' }]
  },
  default: {
    files: [
      { name: 'package.json', path: 'package.json', purpose: 'Manifesto e scripts npm' },
      { name: 'server.js', path: 'server.js', purpose: 'Entrypoint HTTP' },
      { name: 'db.js', path: 'db.js', purpose: 'Camada de persistência' },
      { name: 'controller.js', path: 'controllers/controller.js', purpose: 'Handlers HTTP' }
    ],
    adrs: [
      {
        id: 'ADR-0001',
        title: 'Layout MVC simples',
        status: 'Proposto',
        context: 'Precisamos de estrutura modular.',
        decision: 'Separar rotas, controllers e models.',
        consequences: 'Facilita testes e crescimento.'
      }
    ],
    apiContracts: [
      {
        method: 'GET',
        path: '/health',
        description: 'Healthcheck operacional',
        response: { success: true, status: 'ok' }
      }
    ],
    dataModels: [],
    dependencies: [{ name: 'express', version: '^4.19.2', reason: 'Servidor HTTP' }],
    nonFunctional: [{ area: 'operacao', requirement: 'PORT via process.env' }]
  }
};

function mockPlan(prompt) {
  const lower = prompt.toLowerCase();
  if (lower.includes('auth') || lower.includes('login') || lower.includes('jwt')) return MOCK_TEMPLATES.auth;
  if (lower.includes('crud') || lower.includes('task') || lower.includes('todo')) return MOCK_TEMPLATES.crud;
  return MOCK_TEMPLATES.default;
}

const ARCHITECT_CONTRACT = `Planeje a arquitetura completa para o requisito.
Prefira o menor desenho seguro que atenda o problema; documente trade-offs reais nos ADRs.
Inclua entrypoint, package.json quando for Node, e fronteiras claras (rotas/serviços/persistência).
Defina contratos de API concretos (método, path, auth, request/response) quando houver HTTP.
Modele entidades de dados mínimas; liste dependências npm justificadas; capture NFRs (segurança, observabilidade).
Retorne APENAS JSON estrito:
{
  "files": [{"name": "nome", "path": "caminho/arquivo", "purpose": "papel do arquivo"}],
  "adrs": [{"id": "ADR-0001", "title": "...", "status": "Proposto", "context": "...", "decision": "...", "consequences": "..."}],
  "apiContracts": [{"method": "GET|POST|PUT|PATCH|DELETE", "path": "/api/...", "description": "...", "auth": false|"Bearer ...", "request": {}, "response": {}}],
  "dataModels": [{"name": "Entity", "description": "...", "fields": [{"name": "id", "type": "string", "required": true}]}],
  "dependencies": [{"name": "express", "version": "^4.x", "reason": "..."}],
  "nonFunctional": [{"area": "segurança|observabilidade|performance", "requirement": "..."}],
  "testScenarios": [
    {
      "name": "nome do caso",
      "method": "GET|POST|PUT|PATCH|DELETE",
      "path": "/api/... ou /health",
      "body": {} ou null,
      "auth": true ou false,
      "expectedStatus": "2xx|4xx|200|201|401",
      "expect": "none|list|object-id|token|field:nome=valor",
      "captureAs": "variavelOpcional"
    }
  ]
}
Gere testScenarios executáveis (mín. 3) alinhados aos apiContracts — o QA rodará estes casos literalmente.`;

const ARCHITECT_REVIEW_CONTRACT = `Revise o plano arquitetural como arquiteto sênior.
Verifique: fronteiras claras, contratos API coerentes com os ADRs, modelo de dados mínimo,
dependências justificadas (sem bloat), NFRs de segurança/observabilidade, arquivos faltantes óbvios.
Retorne APENAS JSON:
{
  "verdict": "aprovado|ressalvas|reprovado",
  "summary": "1-3 frases",
  "risks": ["risco arquitetural concreto..."],
  "planAmendments": {
    "files": [{"name": "...", "path": "...", "purpose": "..."}],
    "adrs": [{"id": "ADR-...", "title": "...", "status": "Proposto", "context": "...", "decision": "...", "consequences": "..."}],
    "apiContracts": [{"method": "GET", "path": "/api/...", "description": "...", "auth": false, "request": {}, "response": {}}],
    "dataModels": [{"name": "...", "fields": [{"name": "...", "type": "string", "required": true}]}],
    "dependencies": [{"name": "...", "version": "^x", "reason": "..."}],
    "nonFunctional": [{"area": "segurança", "requirement": "..."}],
    "testScenarios": [{"name": "...", "method": "GET", "path": "/health", "expectedStatus": "200", "expect": "none"}]
  }
}
Inclua em planAmendments SOMENTE itens novos ou correções — não repita o plano inteiro.`;

async function runSeniorReview(plan, prompt, runConfig, orchestrator) {
  const { thinkAsSenior } = require('../lib/seniorEngineer');
  const senior = await thinkAsSenior({
    role: 'architect',
    taskContract: ARCHITECT_REVIEW_CONTRACT,
    userPayload: {
      requirement: prompt,
      plan: normalizePlan(plan)
    },
    runConfig,
    orchestrator
  });

  if (!senior) return plan;

  let merged = plan;
  if (senior.planAmendments && typeof senior.planAmendments === 'object') {
    merged = mergePlanAmendments(plan, senior.planAmendments);
    orchestrator.log('architect', 'Revisão sênior aplicou emendas ao plano arquitetural.', 'info');
  }

  if (senior.summary) {
    const level =
      senior.verdict === 'aprovado' ? 'success' : senior.verdict === 'reprovado' ? 'warning' : 'info';
    orchestrator.log('architect', `Revisão sênior: ${senior.summary}`, level);
  }

  merged.seniorReview = {
    verdict: senior.verdict || 'ressalvas',
    summary: senior.summary || '',
    risks: Array.isArray(senior.risks) ? senior.risks : []
  };
  return merged;
}

module.exports = {
  execute: async (prompt, runConfig, orchestrator) => {
    orchestrator.log('architect', 'Analisando requisitos...', 'info');
    orchestrator.throwIfAborted();
    const { announceThinking } = require('../lib/seniorEngineer');
    announceThinking(orchestrator, 'architect');

    let plan;

    try {
      const { resolveProvider } = require('../lib/llm');
      const provider = resolveProvider(runConfig);
      orchestrator.log('architect', `Planejando com ${provider}...`, 'info');
      const result = await generateJson({
        system: composeSystemPrompt('architect', ARCHITECT_CONTRACT, runConfig),
        user: `Requisito: ${prompt}`,
        runConfig,
        signal: orchestrator.getSignal()
      });
      if (result.tokens) {
        orchestrator.recordTokens(result.tokens, {
          provider: result.provider,
          model: result.model
        });
      }
      plan = normalizePlan(result.data);
      if (!plan.files.length) throw new Error('O LLM retornou um plano de arquivos vazio');
      orchestrator.log('architect', `Plano inicial recebido via ${result.provider}.`, 'success');
    } catch (err) {
      if (!config.allowMocks) {
        throw new Error(`Falha no LLM do Arquiteto (mocks desligados): ${err.message}`);
      }
      orchestrator.log('architect', `Falha no LLM (${err.message}); usando templates offline.`, 'warning');
      plan = normalizePlan(structuredClone(mockPlan(prompt)));
    }

    orchestrator.throwIfAborted();
    plan = await runSeniorReview(plan, prompt, runConfig, orchestrator);
    orchestrator.log('architect', `Planejamento concluído (${summarizePlan(plan)}).`, 'success');
    return plan;
  }
};
