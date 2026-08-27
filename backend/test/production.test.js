const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_API_TOKEN = 'test-token-forja';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'true';
process.env.FORJA_WORKSPACE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-ws-'));
process.env.FORJA_DB_PATH = path.join(os.tmpdir(), `forja-test-${Date.now()}.db`);
process.env.HOST = '127.0.0.1';
process.env.PORT = '3099';

// Clear cached modules that read config at import time
function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('paths allowlist', () => {
  it('rejects escape outside workspace', () => {
    const { resolveWithinWorkspace } = fresh('../lib/paths');
    assert.throws(() => resolveWithinWorkspace('../outside'), /sai da raiz do workspace|escapes workspace/i);
  });

  it('allows relative path inside workspace', () => {
    const fs = require('fs');
    const config = fresh('../lib/config');
    const { resolveWithinWorkspace } = fresh('../lib/paths');
    const resolved = resolveWithinWorkspace('deployed');
    const rootReal = fs.existsSync(config.workspaceRoot)
      ? fs.realpathSync(config.workspaceRoot)
      : config.workspaceRoot;
    assert.ok(
      resolved.startsWith(rootReal) || resolved.startsWith(config.workspaceRoot),
      `resolved=${resolved} root=${config.workspaceRoot}`
    );
  });
});

describe('auth middleware', () => {
  it('rejects missing token', () => {
    const { authMiddleware } = fresh('../lib/auth');
    let status = 0;
    const req = { headers: {}, query: {} };
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json() {
        return this;
      }
    };
    authMiddleware(req, res, () => {
      throw new Error('should not call next');
    });
    assert.equal(status, 401);
  });

  it('accepts bearer token', () => {
    const { authMiddleware } = fresh('../lib/auth');
    const config = fresh('../lib/config');
    let called = false;
    const req = { headers: { authorization: `Bearer ${config.apiToken}` }, query: {} };
    const res = {
      status() {
        return this;
      },
      json() {
        return this;
      }
    };
    authMiddleware(req, res, () => {
      called = true;
    });
    assert.equal(called, true);
  });
});

describe('LLM fail-closed', () => {
  it('fails without provider when mocks disabled', async () => {
    process.env.GEMINI_API_KEY = '';
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1';
    process.env.FORJA_ALLOW_MOCKS = 'false';
    // reload config+llm
    delete require.cache[require.resolve('../lib/config')];
    delete require.cache[require.resolve('../lib/llm')];
    // Force empty key
    const config = require('../lib/config');
    config.geminiApiKey = '';
    config.allowMocks = false;
    config.ollamaBaseUrl = 'http://127.0.0.1:1';
    const { generateJson } = require('../lib/llm');
    await assert.rejects(
      () =>
        generateJson({
          system: 'x',
          user: 'y',
          runConfig: { useOllama: true, ollamaModel: 'none' }
        }),
      /No LLM|Ollama|failed|fetch|Aborted|ECONNREFUSED|error/i
    );
  });
});

describe('devops prepareSandbox contract', () => {
  it('exports prepareSandbox that starts runner', () => {
    const devops = fresh('../agent/devops');
    assert.equal(typeof devops.prepareSandbox, 'function');
    assert.equal(typeof devops.cleanupSandbox, 'function');
    assert.equal(typeof devops.killDeploy, 'function');
  });
});

describe('projectId virtual ws: resolves without FK crash', () => {
  it('creates run with ws: projectId by registering the path', () => {
    const fs = require('fs');
    const path = require('path');
    const config = fresh('../lib/config');
    const appPath = path.join(config.workspaceRoot, 'demo-app');
    fs.mkdirSync(appPath, { recursive: true });
    const { projects, runs } = fresh('../lib/db');
    const run = runs.create({
      projectId: 'ws:demo-app',
      prompt: 'test',
      config: { sourcePath: 'demo-app', targetPath: 'demo-app' }
    });
    assert.ok(run.id);
    assert.ok(run.project_id, 'deve registrar projeto real');
    assert.ok(!String(run.project_id).startsWith('ws:'));
    assert.ok(projects.get(run.project_id));
  });
});
