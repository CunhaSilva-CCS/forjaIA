const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-healerfs-${Date.now()}.db`);

describe('healer.collectFlaggedPaths', () => {
  it('coleta paths de securityReport.issues[].file', () => {
    const { collectFlaggedPaths } = require('../agent/healer');
    const known = new Set(['src/app.ts', 'src/routes/auth.ts', 'package.json']);
    const flagged = collectFlaggedPaths(
      known,
      { issues: [{ file: 'src/routes/auth.ts', title: 'CORS aberto' }] },
      null
    );
    assert.deepEqual([...flagged], ['src/routes/auth.ts']);
  });

  it('coleta paths de diagnosis.recommendedFixes[].files e rootCauses[].affectedFiles', () => {
    const { collectFlaggedPaths } = require('../agent/healer');
    const known = new Set(['a.js', 'b.js', 'c.js']);
    const flagged = collectFlaggedPaths(known, null, {
      recommendedFixes: [{ priority: 1, action: 'corrigir a.js', files: ['a.js'] }],
      rootCauses: [{ id: 'X', affectedFiles: ['c.js'] }]
    });
    assert.deepEqual([...flagged].sort(), ['a.js', 'c.js']);
  });

  it('ignora paths que não existem na lista de arquivos conhecidos', () => {
    const { collectFlaggedPaths } = require('../agent/healer');
    const known = new Set(['a.js']);
    const flagged = collectFlaggedPaths(known, { issues: [{ file: 'nao-existe.js' }] }, null);
    assert.equal(flagged.size, 0);
  });
});

describe('healer.findDependents', () => {
  it('acha arquivos que citam o nome-base de um arquivo sinalizado', () => {
    const { findDependents } = require('../agent/healer');
    const files = [
      { path: 'src/middleware/auth.ts', content: 'export function authenticate() {}' },
      { path: 'src/routes/clientes.routes.ts', content: "import { authenticate } from '../middleware/auth';" },
      { path: 'src/utils/format.ts', content: 'export function formatDate() {}' }
    ];
    const dependents = findDependents(files, new Set(['src/middleware/auth.ts']));
    assert.deepEqual([...dependents], ['src/routes/clientes.routes.ts']);
  });

  it('não inclui o próprio arquivo já sinalizado', () => {
    const { findDependents } = require('../agent/healer');
    const files = [{ path: 'auth.ts', content: 'authenticate self-reference authenticate' }];
    const dependents = findDependents(files, new Set(['auth.ts']));
    assert.equal(dependents.size, 0);
  });
});

describe('healer.execute — escalada de provedor na última tentativa (ADR-013)', () => {
  function fresh(mod) {
    delete require.cache[require.resolve(mod)];
    return require(mod);
  }

  it('runConfig.escalateProvider=true → usa um provedor diferente do primário da run', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    fresh('../lib/config');
    fresh('../lib/llm');
    const healer = fresh('../agent/healer');

    const originalFetch = global.fetch;
    let calledGemini = false;
    let calledClaude = false;
    global.fetch = async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        calledGemini = true;
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"files":[{"path":"a.js","content":"fixed"}]}' }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 }
          })
        };
      }
      calledClaude = true;
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"files":[{"path":"a.js","content":"fixed"}]}' }],
          usage: {}
        })
      };
    };

    const orchestrator = {
      throwIfAborted: () => {},
      log: () => {},
      recordTokens: () => {},
      getSignal: () => undefined
    };

    try {
      await healer.execute(
        [{ path: 'a.js', content: 'broken' }],
        { tests: [], passed: false },
        { issues: [], passed: true },
        { llmProvider: 'claude', escalateProvider: true },
        orchestrator
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(calledGemini, true, 'esperava escalar para o Gemini (alternativa ao Claude)');
    assert.equal(calledClaude, false, 'não deveria ter insistido no Claude na última tentativa');
  });
});

describe('healer.execute — ignora item sem path válido em vez de quebrar a cura inteira', () => {
  function fresh(mod) {
    delete require.cache[require.resolve(mod)];
    return require(mod);
  }

  it('achado real ao validar o secPass: um arquivo sem path derrubava path.basename(undefined)', async () => {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key';
    const healer = fresh('../agent/healer');

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            // Segundo item sem "path" — é exatamente o que o Ollama devolveu na validação real.
            text: '{"files":[{"path":"a.js","content":"fixed"},{"content":"sem path nenhum"}]}'
          }
        ],
        usage: {}
      })
    });

    const orchestrator = {
      throwIfAborted: () => {},
      log: () => {},
      recordTokens: () => {},
      getSignal: () => undefined
    };

    let result;
    try {
      result = await healer.execute(
        [{ path: 'a.js', content: 'broken' }],
        { tests: [], passed: false },
        { issues: [], passed: true },
        { llmProvider: 'claude' },
        orchestrator
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.length, 1);
    assert.equal(result[0].content, 'fixed');
  });
});
