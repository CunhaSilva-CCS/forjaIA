const path = require('path');
const config = require('../lib/config');
const { generateJson, resolveReviewProvider } = require('../lib/llm');
const { composeSystemPrompt, announceThinking } = require('../lib/seniorEngineer');

function reportBlob(report) {
  return [
    report?.userReport || '',
    report?.humanReport?.notesForUserFix || '',
    JSON.stringify(report?.humanReport?.issues || []),
    JSON.stringify(report?.humanReport?.session?.failedSteps || [])
  ].join('\n');
}

function wantsRootRoute(report) {
  const blob = reportBlob(report);
  return (
    /GET\s+\/\s*→\s*404|Esperava HTTP 200.*404|página inicial|open-home|home.*404|GET \/ → 404/i.test(
      blob
    ) ||
    (Array.isArray(report?.humanReport?.issues) &&
      report.humanReport.issues.some((i) =>
        /GET\s+\/|página inicial|home|open-home/i.test(JSON.stringify(i || {}))
      ))
  );
}

function findAppEntry(files) {
  const preferred = [
    /^src\/app\.(ts|js|mjs|cjs)$/i,
    /^app\.(ts|js|mjs|cjs)$/i,
    /^src\/server\.(ts|js)$/i,
    /^server\.(ts|js)$/i,
    /^src\/index\.(ts|js)$/i,
    /^index\.(ts|js)$/i
  ];
  for (const re of preferred) {
    const hit = (files || []).find((f) => re.test(String(f.path || '').replace(/\\/g, '/')));
    if (hit && /express|fastify|koa|hono|createServer|Router/i.test(hit.content || '')) {
      return hit;
    }
  }
  return (files || []).find(
    (f) =>
      /\.(ts|js|mjs)$/i.test(f.path || '') &&
      /express\(\)|from ['"]express['"]|require\(['"]express['"]\)/.test(f.content || '') &&
      /app\.(get|use)\(/.test(f.content || '')
  );
}

function injectRootRoute(content) {
  if (/app\.get\(\s*['"]\/['"]/.test(content)) {
    return { content, changed: false };
  }

  // Prefer reutilizar o handler de health já existente
  if (
    /healthCheckHandler/.test(content) &&
    /app\.get\(\s*['"]\/(?:api\/)?health['"]\s*,\s*healthCheckHandler\)/.test(content)
  ) {
    const next = content.replace(
      /(app\.get\(\s*['"]\/api\/health['"]\s*,\s*healthCheckHandler\);)/,
      `$1\napp.get('/', healthCheckHandler);`
    );
    if (next !== content) return { content: next, changed: true };
    const alt = content.replace(
      /(app\.get\(\s*['"]\/health['"]\s*,\s*healthCheckHandler\);)/,
      `$1\napp.get('/', healthCheckHandler);`
    );
    if (alt !== content) return { content: alt, changed: true };
  }

  const isTs =
    /import\s+.*from\s+['"]express['"]/.test(content) &&
    /:\s*(express\.)?(Request|Response)/.test(content);
  const handler = isTs
    ? `const rootHandler = (_req: express.Request, res: express.Response): void => {
  res.status(200).json({
    status: 'ok',
    service: 'api',
    health: '/api/health'
  });
};
`
    : `const rootHandler = (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'api',
    health: '/api/health'
  });
};
`;
  const routeLine = `app.get('/', rootHandler);\n`;

  let next = content;
  if (/app\.get\(\s*['"]\/api\/health['"]/.test(next)) {
    next = next.replace(
      /(app\.get\(\s*['"]\/api\/health['"][^;]*;)/,
      `$1\n${routeLine}`
    );
  } else if (/app\.get\(\s*['"]\/health['"]/.test(next)) {
    next = next.replace(/(app\.get\(\s*['"]\/health['"][^;]*;)/, `$1\n${routeLine}`);
  } else if (/app\.use\(\s*['"]\/api\//.test(next)) {
    next = next.replace(/(app\.use\(\s*['"]\/api\/)/, `${routeLine}\n$1`);
  } else {
    return { content, changed: false };
  }

  if (/app\.get\(\s*['"]\/['"]\s*,\s*rootHandler\)/.test(next) && !/const rootHandler\s*=/.test(next)) {
    const idx = next.search(/app\.get\(\s*['"]\/['"]\s*,\s*rootHandler\)/);
    next = `${next.slice(0, idx)}${handler}${next.slice(idx)}`;
  }

  if (next === content) return { content, changed: false };
  return { content: next, changed: true };
}

function applyHeuristicFixes(files, report) {
  if (!wantsRootRoute(report)) return null;
  const entry = findAppEntry(files);
  if (!entry) return null;

  const { content, changed } = injectRootRoute(entry.content || '');
  if (!changed) return null;

  return {
    files: (files || []).map((f) => (f.path === entry.path ? { ...f, content } : f)),
    summary: `Heurística: adicionada rota GET / em ${entry.path} para o teste humano in loco.`
  };
}

/**
 * Paths mencionados no texto do relato (nome do arquivo ou caminho completo) ou nos achados do
 * simulador humanístico — mesmo espírito de agent/healer.js's collectFlaggedPaths, adaptado pra
 * texto livre em vez de relatório estruturado. Achado real validando o secPass: sem isso,
 * userFix.js mandava TODO o codebase (183 arquivos, ~505 mil tokens) numa chamada só, mesmo pra
 * um relato citando 3 arquivos específicos — estourava qualquer contexto de LLM.
 */
function collectFlaggedPathsFromReport(knownPaths, userReport, humanReport) {
  const flagged = new Set();
  const text = String(userReport || '');
  for (const p of knownPaths) {
    const base = path.basename(p);
    if (text.includes(p) || (base.length > 3 && text.includes(base))) {
      flagged.add(p);
    }
  }
  for (const issue of humanReport?.issues || []) {
    if (issue?.file && knownPaths.has(issue.file)) flagged.add(issue.file);
  }
  return flagged;
}

/**
 * Corrige erros relatados pelo usuário humano (ou achados do simulador humanístico).
 */
module.exports = {
  collectFlaggedPathsFromReport,
  execute: async (files, report, runConfig, orchestrator) => {
    orchestrator.throwIfAborted();
    announceThinking(orchestrator, 'userFix');

    const userReport = report?.userReport || runConfig?.userReport || '';
    const humanReport = report?.humanReport || runConfig?.humanReport || null;
    const fixReport = { userReport, humanReport };

    if (!String(userReport).trim() && !humanReport?.issues?.length) {
      throw new Error('Nenhum relato de erro do usuário (nem achados do simulador humano).');
    }

    orchestrator.log(
      'userFix',
      'Aplicando correções a partir do relato humano / verificação em tela…',
      'info'
    );

    const system = composeSystemPrompt(
      'userFix',
      `Você corrige bugs e problemas de apresentação relatados por um usuário humano.
Patches mínimos, código completo nos arquivos alterados (não diffs).
Retorne APENAS JSON:
{ "files": [{"path":"...", "content":"..."}], "summary": "o que foi corrigido" }
Nunca grave segredos; use process.env.
Priorize o texto do usuário e notesForUserFix do simulador humanístico.
Se GET / retornar 404 em API Express, adicione app.get('/', ...) com JSON de status.`,
      runConfig
    );

    // Mandar o codebase inteiro é caro/lento e pode estourar o contexto do LLM em projetos
    // reais — manda só os arquivos citados no relato + quem os importa, resto só por path.
    // Sem nada reconhecível no texto, cai pro codebase completo (mesmo comportamento de antes).
    const { findDependents } = require('./healer');
    const knownPaths = new Set((files || []).map((f) => f.path));
    const flaggedPaths = collectFlaggedPathsFromReport(knownPaths, userReport, humanReport);
    const dependentPaths = flaggedPaths.size ? findDependents(files, flaggedPaths) : new Set();
    const selectedPaths = new Set([...flaggedPaths, ...dependentPaths]);
    const pkg = (files || []).find((f) => f.path === 'package.json');
    if (pkg) selectedPaths.add(pkg.path);

    const useSelective = selectedPaths.size > 0 && selectedPaths.size < (files || []).length;
    const filesToSend = useSelective ? files.filter((f) => selectedPaths.has(f.path)) : files;
    const manifestOnly = useSelective ? files.filter((f) => !selectedPaths.has(f.path)) : [];

    if (useSelective) {
      orchestrator.log(
        'userFix',
        `Enviando ${filesToSend.length}/${files.length} arquivo(s) relevantes ao Corretor (resto só por path).`,
        'info'
      );
    }

    const user = `
Relato do usuário (prioridade máxima):
${userReport || '(nenhum texto — usar só achados do simulador)'}

Relatório do Simulador Humanístico (tela):
${JSON.stringify(humanReport || null)}

Arquivos com conteúdo completo (relevantes ao relato):
${JSON.stringify(filesToSend.map((f) => ({ path: f.path, content: f.content })))}
${
  manifestOnly.length
    ? `\nOutros arquivos do projeto que existem mas não foram incluídos por não parecerem relevantes
(se descobrir que precisa editar algum, pode devolvê-lo mesmo assim — use o path exato):
${JSON.stringify(manifestOnly.map((f) => f.path))}\n`
    : ''
}
Corrija os problemas relatados. Devolva o conteúdo completo de cada arquivo alterado.
`;

    // Achado real (auditoria funcional ao vivo, ver ADR-026): tentar de novo com o MESMO
    // provedor que já falhou repetidas vezes tende a repetir o mesmo erro de formatação/
    // raciocínio — mesmo critério que o Curador já usa (ADR-013), escalando só quando já não há
    // muito a perder (a partir da 3ª tentativa, ver userFixStage.js).
    const effectiveRunConfig = runConfig.escalateProvider
      ? { ...runConfig, llmProvider: resolveReviewProvider(runConfig) }
      : runConfig;
    if (runConfig.escalateProvider) {
      orchestrator.log(
        'userFix',
        `Tentativa ${orchestrator.userFixAttempts + 1} — escalando para o provedor ${effectiveRunConfig.llmProvider}.`,
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
      if (!Array.isArray(result.data?.files)) {
        throw new Error('O Corretor do Usuário não retornou arquivos');
      }
      // Lista vazia é uma resposta válida: o LLM pode legitimamente concluir que nada
      // no código precisa mudar (ex.: o problema relatado era de configuração de deploy,
      // não do app) — nesse caso os arquivos originais seguem inalterados, sem erro.
      if (!result.data.files.length) {
        orchestrator.log(
          'userFix',
          result.data.summary || `Nenhuma alteração de código necessária (via ${result.provider}).`,
          'success'
        );
        return files || [];
      }
      // Achado real (mesmo bug do healer.js, ver ADR-014): um item sem "path" válido no meio de
      // uma resposta boa virava chave undefined no Map e quebrava path.basename() mais abaixo.
      const validFiles = result.data.files.filter((f) => f && typeof f.path === 'string' && f.path.trim());
      if (validFiles.length < result.data.files.length) {
        orchestrator.log(
          'userFix',
          `${result.data.files.length - validFiles.length} arquivo(s) retornado(s) sem path válido, ignorado(s).`,
          'warning'
        );
      }
      if (!validFiles.length) {
        throw new Error('O Corretor do Usuário não retornou arquivos com path válido');
      }

      if (result.data.summary) {
        orchestrator.log('userFix', result.data.summary, 'success');
      } else {
        orchestrator.log('userFix', `Correções aplicadas via ${result.provider}.`, 'success');
      }

      const byPath = new Map(validFiles.map((f) => [f.path, f.content]));
      const patched = (files || []).map((orig) => {
        if (!byPath.has(orig.path)) return orig;
        const content = byPath.get(orig.path);
        byPath.delete(orig.path);
        return { ...orig, content };
      });
      const newFiles = [...byPath].map(([filePath, content]) => ({
        name: path.basename(filePath),
        path: filePath,
        content
      }));
      if (newFiles.length) {
        orchestrator.log('userFix', `${newFiles.length} arquivo(s) novo(s) criado(s) pela correção.`, 'info');
      }
      return [...patched, ...newFiles];
    } catch (err) {
      const heuristic = applyHeuristicFixes(files, fixReport);
      if (heuristic?.files?.length) {
        orchestrator.log(
          'userFix',
          `${heuristic.summary} (fallback sem LLM: ${err.message})`,
          'warning'
        );
        return heuristic.files;
      }
      if (!config.allowMocks) {
        throw new Error(`Falha no LLM do Corretor do Usuário: ${err.message}`);
      }
      orchestrator.log('userFix', `LLM indisponível (${err.message}).`, 'warning');
      throw err;
    }
  }
};
