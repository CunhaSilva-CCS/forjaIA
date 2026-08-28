const path = require('path');
const config = require('../lib/config');
const { generateJson, resolveReviewProvider } = require('../lib/llm');
const { composeSystemPrompt, announceThinking } = require('../lib/seniorEngineer');

/** Paths que o Depurador/Segurança já apontaram como a causa concreta do problema. */
function collectFlaggedPaths(knownPaths, securityReport, diagnosis) {
  const flagged = new Set();
  for (const issue of securityReport?.issues || []) {
    if (issue?.file && knownPaths.has(issue.file)) flagged.add(issue.file);
  }
  for (const fix of diagnosis?.recommendedFixes || []) {
    for (const p of fix?.files || []) {
      if (knownPaths.has(p)) flagged.add(p);
    }
  }
  for (const cause of diagnosis?.rootCauses || []) {
    for (const p of cause?.affectedFiles || []) {
      if (knownPaths.has(p)) flagged.add(p);
    }
  }
  return flagged;
}

/** Um hop: outros arquivos que citam o nome-base de um arquivo sinalizado (ex.: quem importa
 * o middleware quebrado) — cobre problemas que atravessam mais de um arquivo. */
function findDependents(files, flaggedPaths) {
  const baseNames = [...flaggedPaths]
    .map((p) => path.basename(p, path.extname(p)))
    .filter(Boolean);
  const extra = new Set();
  for (const file of files) {
    if (flaggedPaths.has(file.path)) continue;
    const content = String(file.content || '');
    if (baseNames.some((base) => content.includes(base))) extra.add(file.path);
  }
  return extra;
}

module.exports = {
  collectFlaggedPaths,
  findDependents,
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

    // Reenviar o codebase inteiro a cada cura é caro e lento (é o maior gargalo de tempo do
    // pipeline em projetos com muitos arquivos) — manda só os arquivos apontados pelo
    // Depurador/Segurança + quem os importa, com o resto listado só por path pra manter o
    // Curador ciente da estrutura do projeto sem pagar o custo do conteúdo inteiro. Se nada
    // foi sinalizado com precisão, cai para o codebase completo (mesmo comportamento de antes).
    const diagnosis = runConfig.diagnosis || null;
    const knownPaths = new Set(files.map((f) => f.path));
    const flaggedPaths = collectFlaggedPaths(knownPaths, securityReport, diagnosis);
    const dependentPaths = flaggedPaths.size ? findDependents(files, flaggedPaths) : new Set();
    const selectedPaths = new Set([...flaggedPaths, ...dependentPaths]);
    const pkg = files.find((f) => f.path === 'package.json');
    if (pkg) selectedPaths.add(pkg.path);

    const useSelective = selectedPaths.size > 0 && selectedPaths.size < files.length;
    const filesToSend = useSelective ? files.filter((f) => selectedPaths.has(f.path)) : files;
    const manifestOnly = useSelective ? files.filter((f) => !selectedPaths.has(f.path)) : [];

    if (useSelective) {
      orchestrator.log(
        'healer',
        `Enviando ${filesToSend.length}/${files.length} arquivo(s) relevantes ao Curador (resto só por path).`,
        'info'
      );
    }

    const user = `
Arquivos com conteúdo completo (relevantes ao problema):
${JSON.stringify(filesToSend.map((f) => ({ path: f.path, content: f.content })))}
${
  manifestOnly.length
    ? `\nOutros arquivos do projeto que existem mas não foram incluídos por não parecerem relevantes
(se descobrir que precisa editar algum, pode devolvê-lo mesmo assim — use o path exato):
${JSON.stringify(manifestOnly.map((f) => f.path))}\n`
    : ''
}
Testes que falharam:
${JSON.stringify(testReport)}

Achados de segurança:
${JSON.stringify(securityReport)}

Diagnóstico do Depurador Sênior (use como guia prioritário):
${JSON.stringify(diagnosis)}

Instruções diretas do Depurador (notesForHealer):
${diagnosis?.notesForHealer || '(nenhuma)'}

Reescreva os arquivos corrigindo TODOS os problemas relatados, priorizando recommendedFixes e notesForHealer.
`;

    // Última tentativa antes do teto (ver ADR-013): tentar de novo com o mesmo provedor que já
    // falhou 2x tende a repetir o mesmo erro de raciocínio — escala pra um provedor diferente
    // só nesse ponto, quando já não há muito a perder.
    const effectiveRunConfig = runConfig.escalateProvider
      ? { ...runConfig, llmProvider: resolveReviewProvider(runConfig) }
      : runConfig;
    if (runConfig.escalateProvider) {
      orchestrator.log(
        'healer',
        `Última tentativa de cura — escalando para o provedor ${effectiveRunConfig.llmProvider}.`,
        'warning'
      );
    }

    try {
      const result = await generateJson({
        system,
        user,
        runConfig: effectiveRunConfig,
        signal: orchestrator.getSignal()
      });
      if (result.tokens) {
        orchestrator.recordTokens(result.tokens, {
          provider: result.provider,
          model: result.model
        });
      }
      if (!result.data?.files?.length) throw new Error('O Curador não retornou arquivos');

      // Achado ao validar o secPass (projeto real): o LLM às vezes devolve um item sem "path"
      // válido — sem filtrar, isso vira chave undefined no Map e quebra path.basename() mais
      // abaixo com "path argument must be of type string", derrubando a cura inteira por causa
      // de UM item ruim no meio de N corretos.
      const validFiles = result.data.files.filter((f) => f && typeof f.path === 'string' && f.path.trim());
      if (validFiles.length < result.data.files.length) {
        orchestrator.log(
          'healer',
          `${result.data.files.length - validFiles.length} arquivo(s) retornado(s) sem path válido, ignorado(s).`,
          'warning'
        );
      }
      if (!validFiles.length) throw new Error('O Curador não retornou arquivos com path válido');

      orchestrator.log('healer', `Código curado via ${result.provider}.`, 'success');
      // O LLM pode decidir criar arquivo(s) novo(s) (ex.: middleware/rota de auth que não
      // existiam) — sem isso, a resposta era descartada e sobravam imports para arquivos
      // que nunca chegavam a existir no disco (build quebrava com "Cannot find module").
      const healedByPath = new Map(validFiles.map((f) => [f.path, f.content]));
      const patched = files.map((orig) => {
        if (!healedByPath.has(orig.path)) return orig;
        const content = healedByPath.get(orig.path);
        healedByPath.delete(orig.path);
        return { ...orig, content };
      });
      const newFiles = [...healedByPath].map(([filePath, content]) => ({
        name: path.basename(filePath),
        path: filePath,
        content
      }));
      if (newFiles.length) {
        orchestrator.log('healer', `${newFiles.length} arquivo(s) novo(s) criado(s) pela cura.`, 'info');
      }
      return [...patched, ...newFiles];
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
