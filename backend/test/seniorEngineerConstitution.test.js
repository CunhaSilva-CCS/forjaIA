const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-constitution-${Date.now()}.db`);

const { composeSystemPrompt } = require('../lib/seniorEngineer');

/**
 * Achado real (auditoria funcional ao vivo): uma rodada de cura marcou package.json como
 * "type":"module" e uma rodada seguinte do Corretor reescreveu server.js em CommonJS — mesmo com
 * package.json (conteúdo completo) sempre incluído no contexto enviado ao LLM (ver
 * healer.js/userFix.js, ambos já adicionam package.json a selectedPaths incondicionalmente). A
 * causa raiz não era falta de contexto — era o prompt nunca instruir consistência de sistema de
 * módulos. Este teste confirma que a regra está presente pra QUALQUER papel que reescreve código.
 */
describe('CONSTITUIÇÃO — consistência de sistema de módulos (ADR-026, achado real)', () => {
  it('a regra de consistência ESM/CommonJS está presente pra coder, healer e userFix', () => {
    for (const role of ['coder', 'healer', 'userFix']) {
      const prompt = composeSystemPrompt(role, 'missão de teste', {});
      assert.match(
        prompt,
        /Sistema de módulos consistente com package\.json/,
        `regra ausente pro papel ${role}`
      );
      assert.match(prompt, /type.*module/i, `menção a "type":"module" ausente pro papel ${role}`);
    }
  });
});
