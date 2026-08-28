const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-userfix-${Date.now()}.db`);
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('collectFlaggedPathsFromReport (ADR-016)', () => {
  it('reconhece paths completos citados no texto do relato', () => {
    const { collectFlaggedPathsFromReport } = fresh('../agent/userFix');
    const known = new Set(['src/utils/passwordGenerator.js', 'src/services/account.js', 'src/other.js']);
    const flagged = collectFlaggedPathsFromReport(
      known,
      'Corrija src/utils/passwordGenerator.js e também src/services/account.js',
      null
    );
    assert.deepEqual([...flagged].sort(), ['src/services/account.js', 'src/utils/passwordGenerator.js']);
  });

  it('reconhece só o nome-base do arquivo, sem o caminho completo', () => {
    const { collectFlaggedPathsFromReport } = fresh('../agent/userFix');
    const known = new Set(['src/utils/constantTimeCompare.js']);
    const flagged = collectFlaggedPathsFromReport(known, 'o bug está em constantTimeCompare.js', null);
    assert.deepEqual([...flagged], ['src/utils/constantTimeCompare.js']);
  });

  it('inclui paths de humanReport.issues[].file', () => {
    const { collectFlaggedPathsFromReport } = fresh('../agent/userFix');
    const known = new Set(['src/screens/HomeScreen.js']);
    const flagged = collectFlaggedPathsFromReport(known, '', {
      issues: [{ file: 'src/screens/HomeScreen.js', title: 'erro' }]
    });
    assert.deepEqual([...flagged], ['src/screens/HomeScreen.js']);
  });

  it('não sinaliza nada quando o relato não cita arquivo nenhum reconhecível', () => {
    const { collectFlaggedPathsFromReport } = fresh('../agent/userFix');
    const known = new Set(['src/a.js', 'src/b.js']);
    const flagged = collectFlaggedPathsFromReport(known, 'o app está lento em geral', null);
    assert.equal(flagged.size, 0);
  });
});

describe('userFix.execute — envio seletivo de arquivos (ADR-016)', () => {
  it('achado real: relato citando 3 arquivos não manda o codebase inteiro pro LLM', async () => {
    const userFix = fresh('../agent/userFix');
    const files = [
      { path: 'src/utils/passwordGenerator.js', content: 'gen code' },
      { path: 'src/utils/constantTimeCompare.js', content: 'cmp code' },
      { path: 'src/unrelated/bigFile.js', content: 'x'.repeat(50000) },
      { path: 'package.json', content: '{}' }
    ];
    const originalFetch = global.fetch;
    let capturedBody = null;
    global.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"files":[],"summary":"ok"}' }],
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
      await userFix.execute(
        files,
        { userReport: 'Corrija passwordGenerator.js e constantTimeCompare.js', humanReport: null },
        { llmProvider: 'claude' },
        orchestrator
      );
    } finally {
      global.fetch = originalFetch;
    }

    const sentUserText = capturedBody.messages[0].content;
    assert.ok(sentUserText.includes('bigFile.js'), 'o arquivo não-relevante deve aparecer só como path');
    assert.ok(!sentUserText.includes('x'.repeat(50000)), 'o CONTEÚDO do arquivo não-relevante não deveria ser enviado');
    assert.ok(sentUserText.includes('gen code'), 'o conteúdo do arquivo relevante deveria ser enviado');
  });

  it('sem nada reconhecível no relato, cai pro codebase completo (comportamento anterior preservado)', async () => {
    const userFix = fresh('../agent/userFix');
    const files = [
      { path: 'src/a.js', content: 'conteudo a' },
      { path: 'src/b.js', content: 'conteudo b' }
    ];
    const originalFetch = global.fetch;
    let capturedBody = null;
    global.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"files":[],"summary":"ok"}' }], usage: {} }) };
    };
    const orchestrator = { throwIfAborted: () => {}, log: () => {}, recordTokens: () => {}, getSignal: () => undefined };
    try {
      await userFix.execute(
        files,
        { userReport: 'o app está lento em geral', humanReport: null },
        { llmProvider: 'claude' },
        orchestrator
      );
    } finally {
      global.fetch = originalFetch;
    }
    const sentUserText = capturedBody.messages[0].content;
    assert.ok(sentUserText.includes('conteudo a') && sentUserText.includes('conteudo b'));
  });

  it('ignora item sem path válido em vez de quebrar (mesmo bug do healer.js corrigido)', async () => {
    const userFix = fresh('../agent/userFix');
    const files = [{ path: 'a.js', content: 'broken' }];
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: '{"files":[{"path":"a.js","content":"fixed"},{"content":"sem path"}],"summary":"ok"}'
          }
        ],
        usage: {}
      })
    });
    const orchestrator = { throwIfAborted: () => {}, log: () => {}, recordTokens: () => {}, getSignal: () => undefined };
    let result;
    try {
      result = await userFix.execute(
        files,
        { userReport: 'conserta a.js' },
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
