#!/usr/bin/env node
/**
 * Pré-voo para produção local: falha cedo se o ambiente não estiver seguro/pronto.
 */
const path = require('path');
const fs = require('fs');
const { execSync, execFileSync } = require('child_process');

process.chdir(path.join(__dirname, '..'));

// Carrega .env sem sobrescrever NODE_ENV se já veio do shell
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const issues = [];
const notes = [];

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const host = process.env.HOST || '127.0.0.1';
const token = process.env.FORJA_API_TOKEN || '';
const requireDocker = parseBool(process.env.FORJA_REQUIRE_DOCKER, true);
const allowMocks = parseBool(process.env.FORJA_ALLOW_MOCKS, false);
const allowPublic = parseBool(process.env.FORJA_ALLOW_PUBLIC_BIND, false);
const provider = (process.env.FORJA_LLM_PROVIDER || 'ollama').toLowerCase();

if (process.env.NODE_ENV !== 'production') {
  issues.push('NODE_ENV deve ser "production" (use npm run start:local-prod).');
}

if (!token || token.length < 24) {
  issues.push('FORJA_API_TOKEN ausente ou curto demais (mín. 24 chars).');
}

if (allowMocks) {
  issues.push('FORJA_ALLOW_MOCKS=true não é permitido em produção local.');
}

if (!requireDocker) {
  issues.push('FORJA_REQUIRE_DOCKER=false não é permitido em produção local (sandbox deve usar Docker).');
}

const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
if (!loopback.has(host) && !allowPublic) {
  issues.push(
    `HOST=${host} expõe a API fora do loopback. Use 127.0.0.1 ou defina FORJA_ALLOW_PUBLIC_BIND=true conscientemente.`
  );
}

const hasGemini = Boolean(process.env.GEMINI_API_KEY);
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
if (provider === 'ollama') {
  notes.push('LLM: Ollama (local).');
} else if (provider === 'gemini' && !hasGemini) {
  issues.push('FORJA_LLM_PROVIDER=gemini sem GEMINI_API_KEY.');
} else if (provider === 'openai' && !hasOpenAI) {
  issues.push('FORJA_LLM_PROVIDER=openai sem OPENAI_API_KEY.');
} else if (provider === 'claude' && !hasAnthropic) {
  issues.push('FORJA_LLM_PROVIDER=claude sem ANTHROPIC_API_KEY.');
} else if (!['gemini', 'claude', 'openai', 'ollama'].includes(provider)) {
  issues.push(`FORJA_LLM_PROVIDER inválido: ${provider}`);
}

const distIndex = path.join(__dirname, '../frontend/dist/index.html');
if (!fs.existsSync(distIndex)) {
  issues.push('frontend/dist ausente — rode npm run build antes (start:local-prod já faz isso).');
}

try {
  execSync('docker info', { stdio: 'pipe', timeout: 15000 });
  notes.push('Docker: OK');
} catch {
  issues.push('Docker indisponível (`docker info` falhou). Suba o Docker Desktop/Engine.');
}

if (provider === 'ollama') {
  const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  try {
    const res = execFileSync('curl', ['-sf', '--max-time', '3', `${base}/api/tags`], { encoding: 'utf8' });
    const data = JSON.parse(res);
    const n = Array.isArray(data.models) ? data.models.length : 0;
    if (!n) issues.push('Ollama online mas sem modelos — rode `ollama pull qwen2.5-coder:7b`.');
    else notes.push(`Ollama: ${n} modelo(s)`);
  } catch {
    issues.push(`Ollama inacessível em ${base}.`);
  }
}

console.log('=== ForjaIA — check produção local ===');
for (const n of notes) console.log(`  ✓ ${n}`);
if (issues.length) {
  console.error('\nFalhas:');
  for (const i of issues) console.error(`  ✗ ${i}`);
  process.exit(1);
}
console.log('\nPronto para produção local.');
process.exit(0);
