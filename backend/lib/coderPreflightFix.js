const { generateJson } = require('./llm');
const { composeSystemPrompt } = require('./seniorEngineer');

const REMEDIATE_CONTRACT = `Corrija o código para passar no preflight que falhou.
Foque em patches mínimos: rotas/paths exatos do plano, GET /health, package.json válido,
envelope JSON { success, data|error }, status HTTP esperados pelos testScenarios.
Retorne APENAS JSON:
{ "files": [{"path": "caminho/do/arquivo", "content": "código completo corrigido"}] }
Inclua SOMENTE arquivos que você alterou; mantenha o resto intacto mentalmente.`;

const SENIOR_GAP_CONTRACT = `Corrija lacunas apontadas pela revisão sênior de implementação.
Patches mínimos alinhados ao plano arquitetural e cenários QA aprovados.
Retorne APENAS JSON:
{ "files": [{"path": "caminho/do/arquivo", "content": "código completo corrigido"}] }`;

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

async function callCoderPatch(systemContract, userPayload, runConfig, orchestrator) {
  const result = await generateJson({
    system: composeSystemPrompt('coder', systemContract, runConfig),
    user: JSON.stringify(userPayload),
    runConfig,
    signal: orchestrator.getSignal?.()
  });
  if (result.tokens && orchestrator.recordTokens) {
    orchestrator.recordTokens(result.tokens, {
      provider: result.provider,
      model: result.model
    });
  }
  return result;
}

/**
 * Corrige gaps da revisão sênior antes do primeiro preflight.
 */
async function remediateSeniorGaps(files, plan, seniorReview, prompt, runConfig, orchestrator) {
  orchestrator.log('coder', 'Revisão sênior reprovou — correção automática pré-preflight...', 'info');
  const { getPlanTestCases, buildCoderHandoff } = require('./architectPlan');
  try {
    const result = await callCoderPatch(
      SENIOR_GAP_CONTRACT,
      {
        requirement: prompt,
        handoff: buildCoderHandoff(plan),
        testScenarios: getPlanTestCases(plan),
        seniorReview,
        files: (files || []).slice(0, 40).map((f) => ({
          path: f.path,
          preview: String(f.content || '').slice(0, 4000)
        }))
      },
      runConfig,
      orchestrator
    );
    const patches = Array.isArray(result.data?.files) ? result.data.files : [];
    if (!patches.length) return files;
    orchestrator.log(
      'coder',
      `Correção pré-preflight aplicou ${patches.length} arquivo(s) via ${result.provider}.`,
      'success'
    );
    return mergeFilePatches(files, patches);
  } catch (err) {
    orchestrator.log('coder', `Correção pré-preflight falhou (${err.message}).`, 'warning');
    return files;
  }
}

/**
 * Correção automática quando o preflight falha (até N tentativas no pipeline).
 */
async function remediatePreflightFailures(
  files,
  plan,
  preflight,
  prompt,
  runConfig,
  orchestrator,
  attempt = 1
) {
  const failed = (preflight?.tests || []).filter((t) => !t.passed);
  if (!failed.length) return files;

  orchestrator.log(
    'coder',
    `Preflight falhou — correção automática (tentativa ${attempt}) para ${failed.length} check(s)...`,
    'info'
  );

  const { getPlanTestCases, buildCoderHandoff } = require('./architectPlan');
  try {
    const result = await callCoderPatch(
      REMEDIATE_CONTRACT,
      {
        requirement: prompt,
        handoff: buildCoderHandoff(plan),
        testScenarios: getPlanTestCases(plan),
        preflightFailures: failed.map((t) => ({ name: t.name, error: t.error })),
        files: (files || []).slice(0, 40).map((f) => ({
          path: f.path,
          preview: String(f.content || '').slice(0, 4000)
        }))
      },
      runConfig,
      orchestrator
    );
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
  remediateSeniorGaps,
  mergeFilePatches
};
