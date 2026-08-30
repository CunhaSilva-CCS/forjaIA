const { generateJson } = require('./llm');
const { composeSystemPrompt } = require('./seniorEngineer');

const REMEDIATE_CONTRACT = `Corrija o código para passar no preflight que falhou.
Foque em patches mínimos: rotas/paths exatos do plano, GET /health, package.json válido,
envelope JSON { success, data|error }, status HTTP esperados pelos testScenarios.
Retorne APENAS JSON:
{ "files": [{"path": "caminho/do/arquivo", "content": "código completo corrigido"}] }
Inclua SOMENTE arquivos que você alterou; mantenha o resto intacto mentalmente.`;

function mergeFilePatches(existing, patches) {
  const map = new Map((existing || []).map((f) => [f.path, f]));
  for (const patch of patches || []) {
    if (!patch?.path) continue;
    map.set(patch.path, {
      name: patch.name || patch.path.split('/').pop(),
      path: patch.path,
      content: typeof patch.content === 'string' ? patch.content : map.get(patch.path)?.content || ''
    });
  }
  return [...map.values()];
}

/**
 * Uma tentativa automática de correção quando o preflight pós-coder falha (evita ida prematura ao QA).
 */
async function remediatePreflightFailures(files, plan, preflight, prompt, runConfig, orchestrator) {
  const failed = (preflight?.tests || []).filter((t) => !t.passed);
  if (!failed.length) return files;

  orchestrator.log(
    'coder',
    `Preflight falhou — correção automática (1 tentativa) para ${failed.length} check(s)...`,
    'info'
  );

  const { getPlanTestCases, buildCoderHandoff } = require('./architectPlan');
  const preview = (files || []).slice(0, 40).map((f) => ({
    path: f.path,
    preview: String(f.content || '').slice(0, 4000)
  }));

  try {
    const result = await generateJson({
      system: composeSystemPrompt('coder', REMEDIATE_CONTRACT, runConfig),
      user: JSON.stringify({
        requirement: prompt,
        handoff: buildCoderHandoff(plan),
        testScenarios: getPlanTestCases(plan),
        preflightFailures: failed.map((t) => ({ name: t.name, error: t.error })),
        files: preview
      }),
      runConfig,
      signal: orchestrator.getSignal?.()
    });
    if (result.tokens && orchestrator.recordTokens) {
      orchestrator.recordTokens(result.tokens, {
        provider: result.provider,
        model: result.model
      });
    }
    const patches = Array.isArray(result.data?.files) ? result.data.files : [];
    if (!patches.length) {
      orchestrator.log('coder', 'Correção automática não retornou arquivos — mantendo código anterior.', 'warning');
      return files;
    }
    orchestrator.log(
      'coder',
      `Correção automática aplicou ${patches.length} arquivo(s) via ${result.provider}.`,
      'success'
    );
    return mergeFilePatches(files, patches);
  } catch (err) {
    orchestrator.log('coder', `Correção automática falhou (${err.message}).`, 'warning');
    return files;
  }
}

module.exports = {
  remediatePreflightFailures,
  mergeFilePatches
};
