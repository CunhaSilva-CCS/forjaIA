const config = require('../lib/config');
const { generateJson } = require('../lib/llm');
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
 * Corrige erros relatados pelo usuário humano (ou achados do simulador humanístico).
 */
module.exports = {
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

    const user = `
Relato do usuário (prioridade máxima):
${userReport || '(nenhum texto — usar só achados do simulador)'}

Relatório do Simulador Humanístico (tela):
${JSON.stringify(humanReport || null)}

Arquivos atuais:
${JSON.stringify((files || []).map((f) => ({ path: f.path, content: f.content })))}

Corrija os problemas relatados. Devolva o conteúdo completo de cada arquivo alterado.
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
      if (!result.data?.files?.length) {
        throw new Error('O Corretor do Usuário não retornou arquivos');
      }
      if (result.data.summary) {
        orchestrator.log('userFix', result.data.summary, 'success');
      } else {
        orchestrator.log('userFix', `Correções aplicadas via ${result.provider}.`, 'success');
      }

      const byPath = new Map(result.data.files.map((f) => [f.path, f.content]));
      return (files || []).map((orig) =>
        byPath.has(orig.path) ? { ...orig, content: byPath.get(orig.path) } : orig
      );
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
