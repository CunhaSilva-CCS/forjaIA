const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';

describe('validação do provedor cursor', () => {
  it('aceita llmProvider "cursor" e cursorModel no runConfig', () => {
    const { runRequestSchema } = require('../lib/validation');
    const parsed = runRequestSchema.parse({
      prompt: 'criar algo',
      config: { llmProvider: 'cursor', cursorModel: 'auto' }
    });
    assert.equal(parsed.config.llmProvider, 'cursor');
    assert.equal(parsed.config.cursorModel, 'auto');
  });

  it('rejeita um provedor desconhecido', () => {
    const { runRequestSchema } = require('../lib/validation');
    assert.throws(() =>
      runRequestSchema.parse({ prompt: 'x', config: { llmProvider: 'inventado' } })
    );
  });
});

describe('providerStatus() inclui cursor', () => {
  it('expõe { configured, model } para cursor', () => {
    const { providerStatus } = require('../lib/llm');
    const status = providerStatus();
    assert.ok('cursor' in status);
    assert.equal(typeof status.cursor.configured, 'boolean');
    assert.ok(typeof status.cursor.model === 'string' && status.cursor.model.length > 0);
  });
});

describe('extractJson lê o envelope real do cursor-agent --output-format json', () => {
  it('extrai o JSON de dentro do campo result', () => {
    const { extractJson } = require('../lib/llm');
    // Amostra capturada de uma chamada real (cursor-agent -p ... --output-format json --trust)
    const envelope = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '{"files":[{"path":"a.js","content":"x"}],"adrs":[]}',
      session_id: 'abc',
      usage: { inputTokens: 100, outputTokens: 20 }
    };
    const data = extractJson(envelope.result);
    assert.deepEqual(data, { files: [{ path: 'a.js', content: 'x' }], adrs: [] });
  });
});
