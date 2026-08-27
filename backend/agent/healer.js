const config = require('../lib/config');
const { generateJson } = require('../lib/llm');
const { composeSystemPrompt, announceThinking } = require('../lib/seniorEngineer');

module.exports = {
  execute: async (files, testReport, securityReport, runConfig, orchestrator) => {
    orchestrator.throwIfAborted();
    announceThinking(orchestrator, 'healer');

    const system = composeSystemPrompt(
      'healer',
      `Corrija falhas de QA e segurança com patches mínimos e corretos.
Devolva o conteúdo completo dos arquivos corrigidos (não diffs).
Retorne APENAS JSON estrito:
{ "files": [{"path": "caminho/do/arquivo", "content": "código completo corrigido"}] }
Nunca grave segredos no código; use process.env.
Priorize recommendedFixes e notesForHealer do Depurador.`,
      runConfig
    );

    const user = `
Arquivos atuais:
${JSON.stringify(files.map((f) => ({ path: f.path, content: f.content })))}

Testes que falharam:
${JSON.stringify(testReport)}

Achados de segurança:
${JSON.stringify(securityReport)}

Diagnóstico do Depurador Sênior (use como guia prioritário):
${JSON.stringify(runConfig.diagnosis || null)}

Instruções diretas do Depurador (notesForHealer):
${runConfig.diagnosis?.notesForHealer || '(nenhuma)'}

Reescreva os arquivos corrigindo TODOS os problemas relatados, priorizando recommendedFixes e notesForHealer.
`;

    try {
      const result = await generateJson({
        system,
        user,
        runConfig,
        signal: orchestrator.getSignal()
      });
      if (result.tokens) {
        orchestrator.recordTokens(result.tokens, {
          provider: result.provider,
          model: result.model
        });
      }
      if (!result.data?.files?.length) throw new Error('O Curador não retornou arquivos');

      orchestrator.log('healer', `Código curado via ${result.provider}.`, 'success');
      return files.map((orig) => {
        const healed = result.data.files.find((f) => f.path === orig.path);
        return healed ? { ...orig, content: healed.content } : orig;
      });
    } catch (err) {
      if (!config.allowMocks) {
        throw new Error(`Falha no LLM do Curador (mocks desligados): ${err.message}`);
      }

      orchestrator.log('healer', `Falha na cura por LLM (${err.message}); aplicando patches heurísticos.`, 'warning');
      return files.map((file) => {
        let content = file.content || '';
        const filePath = file.path || '';

        if (filePath.includes('taskController.js') && !content.includes('escapeHtml')) {
          content = content.replace(
            `const db = require('../db');`,
            `const db = require('../db');\nfunction escapeHtml(text) {\n  if (typeof text !== 'string') return text;\n  return text.replace(/[&<>\"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#039;' }[m]));\n}`
          );
          content = content.replace(`title: title.trim(),`, `title: escapeHtml(title.trim()),`);
        }

        if (
          (filePath.includes('authController.js') || filePath.includes('authMiddleware.js')) &&
          /JWT_SECRET\s*=\s*process\.env\.JWT_SECRET\s*\|\|/.test(content)
        ) {
          content = content.replace(
            /const JWT_SECRET = process\.env\.JWT_SECRET \|\| ['"][^'"]*['"];?/,
            `const JWT_SECRET = process.env.JWT_SECRET;\nif (!JWT_SECRET) {\n  throw new Error('JWT_SECRET env var is required');\n}`
          );
        }

        if (filePath.endsWith('package.json') && !content.includes('dotenv')) {
          content = content.replace(`"dependencies": {`, `"dependencies": {\n    "dotenv": "^16.4.5",`);
        }

        if (filePath.includes('server.js') && !content.includes("require('dotenv')")) {
          content = `require('dotenv').config();\n` + content;
        }

        return { ...file, content };
      });
    }
  }
};
