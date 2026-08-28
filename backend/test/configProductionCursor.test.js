const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Achado real (pente fino): ADR-007 deixa o Cursor autenticar via sessão local
// (`cursor-agent login`), sem CURSOR_API_KEY — igual a 'ollama'. Mas o guard de produção só
// tratava 'ollama' como isento de chave; configurar FORJA_LLM_PROVIDER=cursor como default de
// produção travava o startup (`throw`) mesmo com uma sessão local válida. node --test roda cada
// arquivo em processo isolado, então mexer em NODE_ENV aqui não vaza pros outros arquivos.
process.env.NODE_ENV = 'production';
process.env.FORJA_API_TOKEN = 'production-config-test-token-min-24-chars';
process.env.FORJA_ALLOW_MOCKS = 'false';
process.env.FORJA_REQUIRE_DOCKER = 'true';
process.env.HOST = '127.0.0.1';
process.env.FORJA_ALLOW_PUBLIC_BIND = 'false';

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('config.js — checagem de produção não bloqueia provedor cursor sem chave (ADR-007)', () => {
  it('FORJA_LLM_PROVIDER=cursor sem CURSOR_API_KEY não derruba o startup', () => {
    process.env.FORJA_LLM_PROVIDER = 'cursor';
    process.env.CURSOR_API_KEY = ''; // vazio (não delete) — dotenv não sobrescreve chave já presente
    assert.doesNotThrow(() => fresh('../lib/config'));
  });

  it('continua exigindo chave pra claude/gemini/openai (comportamento anterior preservado)', () => {
    process.env.FORJA_LLM_PROVIDER = 'claude';
    // Vazio, não delete — o repo tem um .env real com chaves de teste; dotenv só preenche
    // process.env se a variável ainda não existir, então deletar deixaria o .env repopular.
    process.env.ANTHROPIC_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    assert.throws(() => fresh('../lib/config'), /configure a chave do provedor "claude"/);
  });

  it('ollama continua isento de chave (comportamento anterior preservado)', () => {
    process.env.FORJA_LLM_PROVIDER = 'ollama';
    assert.doesNotThrow(() => fresh('../lib/config'));
  });
});
