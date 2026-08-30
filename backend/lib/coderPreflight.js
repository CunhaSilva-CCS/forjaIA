const { detectProjectType } = require('./projectType');
const { getPlanTestCases } = require('./architectPlan');
const { runGeneratedTests } = require('./testPlanRunner');

const HEALTH_PROBES = ['/health', '/api/health', '/'];

function validatePackageJson(files) {
  const pkgFile = (files || []).find((f) => f.path === 'package.json' || f.path.endsWith('/package.json'));
  if (!pkgFile) {
    return { passed: false, error: 'package.json ausente' };
  }
  try {
    JSON.parse(String(pkgFile.content || ''));
    return { passed: true };
  } catch (err) {
    return { passed: false, error: `JSON inválido: ${err.message}` };
  }
}

async function probeHealth(baseUrl) {
  for (const probe of HEALTH_PROBES) {
    try {
      const res = await fetch(`${baseUrl}${probe}`, { signal: AbortSignal.timeout(8000) });
      if (res.status < 500) return { passed: true, probe, status: res.status };
    } catch {
      // tenta próximo probe
    }
  }
  return { passed: false, error: 'Nenhum health probe respondeu (/health, /api/health, /)' };
}

/**
 * Preflight pós-coder: validações estáticas + smoke HTTP na sandbox com cenários do plano.
 */
async function runCoderPreflight(files, plan, orchestrator) {
  const agent = 'coder';
  const tests = [];

  orchestrator.log(agent, 'Preflight: validando artefatos antes do gate de QA...', 'info');

  const pkg = validatePackageJson(files);
  tests.push({
    name: 'package.json válido',
    passed: pkg.passed,
    error: pkg.error || null
  });
  if (!pkg.passed) {
    orchestrator.log(agent, `Preflight reprovado: ${pkg.error}`, 'warning');
    return { passed: false, tests, suite: 'preflight-static' };
  }

  if (detectProjectType(files) === 'mobile-expo') {
    orchestrator.log(agent, 'Preflight: projeto mobile — smoke HTTP não se aplica.', 'info');
    tests.push({ name: 'Preflight mobile (skip HTTP)', passed: true, error: null });
    return { passed: true, tests, suite: 'preflight-mobile-skipped' };
  }

  const planCases = getPlanTestCases(plan);
  if (planCases.length < 2) {
    orchestrator.log(
      agent,
      `Preflight: plano com ${planCases.length} cenário(s) HTTP — smoke limitado (health only).`,
      'info'
    );
  }

  const sandboxRunner = require('../sandbox/runner');
  let sandboxInfo;
  try {
    sandboxInfo = await sandboxRunner.start(files, orchestrator);
    tests.push({ name: 'Sandbox sobe', passed: true, error: null });
  } catch (err) {
    tests.push({ name: 'Sandbox sobe', passed: false, error: err.message });
    orchestrator.log(agent, `Preflight: sandbox falhou (${err.message})`, 'warning');
    return { passed: false, tests, suite: 'preflight-sandbox' };
  }

  try {
    const health = await probeHealth(sandboxInfo.baseUrl);
    tests.push({
      name: 'Healthcheck HTTP',
      passed: health.passed,
      error: health.error || null
    });
    if (health.passed) {
      orchestrator.log(agent, `Preflight: health OK em ${health.probe} (${health.status})`, 'success');
    }

    if (planCases.length >= 2) {
      orchestrator.log(
        agent,
        `Preflight: executando ${planCases.length} cenários aprovados no plano...`,
        'info'
      );
      const scenarioReport = await runGeneratedTests({ cases: planCases }, sandboxInfo.baseUrl, {
        log: (role, msg, type) => orchestrator.log(role === 'qa' ? agent : role, `[preflight] ${msg}`, type)
      });
      for (const t of scenarioReport.tests) {
        tests.push({
          name: `Cenário: ${t.name}`,
          passed: t.passed,
          error: t.error
        });
      }
    }
  } finally {
    try {
      await sandboxRunner.stop(orchestrator);
    } catch {
      // ignore cleanup errors
    }
  }

  const passed = tests.every((t) => t.passed);
  const ok = tests.filter((t) => t.passed).length;
  orchestrator.log(
    agent,
    `Preflight concluído: ${ok}/${tests.length} checks OK.`,
    passed ? 'success' : 'warning'
  );
  return { passed, tests, suite: 'preflight' };
}

module.exports = {
  runCoderPreflight,
  validatePackageJson,
  probeHealth
};
