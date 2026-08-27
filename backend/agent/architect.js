const path = require('path');
const config = require('../lib/config');
const { generateJson } = require('../lib/llm');
const { composeSystemPrompt } = require('../lib/seniorEngineer');

const MOCK_TEMPLATES = {
  auth: {
    files: [
      { name: 'package.json', path: 'package.json' },
      { name: 'server.js', path: 'server.js' },
      { name: 'db.js', path: 'db.js' },
      { name: 'authController.js', path: 'controllers/authController.js' },
      { name: 'authMiddleware.js', path: 'middlewares/authMiddleware.js' },
      { name: 'userModel.js', path: 'models/userModel.js' }
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
    ]
  },
  crud: {
    files: [
      { name: 'package.json', path: 'package.json' },
      { name: 'server.js', path: 'server.js' },
      { name: 'db.js', path: 'db.js' },
      { name: 'taskController.js', path: 'controllers/taskController.js' },
      { name: 'taskModel.js', path: 'models/taskModel.js' }
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
    ]
  },
  default: {
    files: [
      { name: 'package.json', path: 'package.json' },
      { name: 'server.js', path: 'server.js' },
      { name: 'db.js', path: 'db.js' },
      { name: 'controller.js', path: 'controllers/controller.js' }
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
    ]
  }
};

function mockPlan(prompt) {
  const lower = prompt.toLowerCase();
  if (lower.includes('auth') || lower.includes('login') || lower.includes('jwt')) return MOCK_TEMPLATES.auth;
  if (lower.includes('crud') || lower.includes('task') || lower.includes('todo')) return MOCK_TEMPLATES.crud;
  return MOCK_TEMPLATES.default;
}

function normalizePlan(plan) {
  if (!plan) return plan;
  if (plan.files && Array.isArray(plan.files)) {
    plan.files = plan.files.map((f) => {
      const filePath = f.path || f.filePath || f.filename || f.name || 'index.js';
      return { name: f.name || path.basename(filePath), path: filePath };
    });
  }
  if (!plan.adrs) plan.adrs = [];
  return plan;
}

const ARCHITECT_CONTRACT = `Planeje a estrutura de arquivos e ADRs para o requisito.
Prefira o menor desenho seguro que atenda o problema; documente trade-offs reais.
Inclua entrypoint, package.json quando for Node, e fronteiras claras (rotas/serviços/persistência) se aplicável.
Retorne APENAS JSON estrito:
{
  "files": [{"name": "nome_do_arquivo", "path": "caminho/do/arquivo"}],
  "adrs": [{"id": "ADR-0001", "title": "Título", "status": "Proposto", "context": "...", "decision": "...", "consequences": "..."}]
}`;

module.exports = {
  execute: async (prompt, runConfig, orchestrator) => {
    orchestrator.log('architect', 'Analisando requisitos...', 'info');
    orchestrator.throwIfAborted();
    const { composeSystemPrompt, announceThinking } = require('../lib/seniorEngineer');
    announceThinking(orchestrator, 'architect');

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
      const plan = normalizePlan(result.data);
      if (!plan?.files?.length) throw new Error('O LLM retornou um plano de arquivos vazio');
      orchestrator.log('architect', `Plano recebido via ${result.provider}.`, 'success');
      return plan;
    } catch (err) {
      if (!config.allowMocks) {
        throw new Error(`Falha no LLM do Arquiteto (mocks desligados): ${err.message}`);
      }
      orchestrator.log('architect', `Falha no LLM (${err.message}); usando templates offline.`, 'warning');
      return normalizePlan(structuredClone(mockPlan(prompt)));
    }
  }
};
