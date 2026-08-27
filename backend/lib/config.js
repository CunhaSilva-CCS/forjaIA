const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const rootDir = path.join(__dirname, '..');
const dataDir = ensureDir(path.join(rootDir, 'data'));
const defaultWorkspace = ensureDir(path.join(rootDir, 'dev'));

function resolveWorkspaceRoot(raw) {
  if (!raw) return defaultWorkspace;
  let value = String(raw).trim().replace(/\/+$/, '');
  // Aceita "./Users/..." como caminho absoluto mal tipado
  if (value.startsWith('./Users/') || value.startsWith('./home/')) {
    value = value.slice(1);
  }
  if (path.isAbsolute(value)) return path.resolve(value);
  // Relativo à pasta backend/ (não ao cwd), p.ex. ./dev → backend/dev
  return path.resolve(rootDir, value);
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3001),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  apiToken: process.env.FORJA_API_TOKEN || '',
  workspaceRoot: ensureDir(resolveWorkspaceRoot(process.env.FORJA_WORKSPACE_ROOT)),
  dataDir,
  dbPath: process.env.FORJA_DB_PATH || path.join(dataDir, 'forja.db'),

  // Provedores fortes (recomendados para Arquiteto/Codificador/Curador)
  defaultLlmProvider: (process.env.FORJA_LLM_PROVIDER || 'ollama').toLowerCase(),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  anthropicVersion: process.env.ANTHROPIC_VERSION || '2023-06-01',

  // Ollama (opcional / local leve — não ideal como cérebro principal da forja)
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaDefaultModel: process.env.OLLAMA_DEFAULT_MODEL || 'qwen2.5-coder:7b',

  requireDocker: parseBool(process.env.FORJA_REQUIRE_DOCKER, true),
  allowMocks: parseBool(process.env.FORJA_ALLOW_MOCKS, false),
  allowPublicBind: parseBool(process.env.FORJA_ALLOW_PUBLIC_BIND, false),
  llmTimeoutMs: Number(process.env.FORJA_LLM_TIMEOUT_MS || 300000),
  llmRetries: Number(process.env.FORJA_LLM_RETRIES || 2),
  sandboxHostPort: Number(process.env.FORJA_SANDBOX_PORT || 4000),
  deployHostPort: Number(process.env.FORJA_DEPLOY_PORT || 5100),
  stagingHostPort: Number(process.env.FORJA_STAGING_PORT || 5200),
  requireGitPr: parseBool(process.env.FORJA_REQUIRE_GIT_PR, false),
  teamJson: process.env.FORJA_TEAM_JSON || '',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  frontendDist: path.join(rootDir, '../frontend/dist')
};

ensureDir(config.workspaceRoot);

if (!config.apiToken) {
  if (config.isProduction) {
    throw new Error('FORJA_API_TOKEN é obrigatório em produção.');
  }
  const tokenFile = path.join(dataDir, '.api-token');
  if (fs.existsSync(tokenFile)) {
    config.apiToken = fs.readFileSync(tokenFile, 'utf8').trim();
  } else {
    config.apiToken = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(tokenFile, config.apiToken, 'utf8');
  }
  console.warn(`[forja] FORJA_API_TOKEN não definido; usando ${tokenFile}`);
  console.warn(`[forja] Token: ${config.apiToken}`);
}

if (config.isProduction) {
  if (config.apiToken.length < 24) {
    throw new Error('FORJA_API_TOKEN deve ter pelo menos 24 caracteres em produção.');
  }
  if (config.allowMocks) {
    throw new Error('FORJA_ALLOW_MOCKS=true é proibido em produção.');
  }
  if (!config.requireDocker) {
    throw new Error(
      'FORJA_REQUIRE_DOCKER deve ser true em produção local (sandbox isolada).'
    );
  }
  const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!loopback.has(config.host) && !config.allowPublicBind) {
    throw new Error(
      `HOST=${config.host} não é loopback. Use 127.0.0.1 ou FORJA_ALLOW_PUBLIC_BIND=true.`
    );
  }
  const provider = config.defaultLlmProvider;
  const hasKey =
    (provider === 'gemini' && config.geminiApiKey) ||
    (provider === 'openai' && config.openaiApiKey) ||
    (provider === 'claude' && config.anthropicApiKey) ||
    provider === 'ollama';
  if (!hasKey) {
    throw new Error(
      `Produção: configure a chave do provedor "${provider}" ou use FORJA_LLM_PROVIDER=ollama.`
    );
  }
}

module.exports = config;
