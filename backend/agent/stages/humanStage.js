function readDeployedEnv(runConfig) {
  try {
    const fs = require('fs');
    const path = require('path');
    const { resolveWithinWorkspace } = require('../../lib/paths');
    const relativeTarget = runConfig.targetPath || runConfig.sourcePath || 'deployed';
    const envPath = path.join(resolveWithinWorkspace(relativeTarget), '.env');
    if (!fs.existsSync(envPath)) return {};
    const map = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      map[line.slice(0, i).trim()] = line.slice(i + 1);
    }
    return map;
  } catch {
    return {};
  }
}

async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  orchestrator.broadcast('agent-active', { agent: 'human' });

  // Deploy mobile (Simulador) não tem URL HTTP — o teste humano via fetch não se aplica (ver
  // ADR-014). Em vez disso tenta um teste real via Appium/XCUITest (ADR-029) contra o app já
  // instalado; se não houver servidor Appium disponível no ambiente, degrada pro mesmo "skipped"
  // explícito de antes em vez de travar ou inventar resultado.
  const { detectProjectType } = require('../../lib/projectType');
  if (detectProjectType(orchestrator.currentTask.files) === 'mobile-expo') {
    const { runMobileHumanTest } = require('../../lib/mobileHumanTest');
    const simTarget = (orchestrator.currentTask.deployTargets || []).find(
      (t) => t.platform === 'ios-simulator' && t.ok
    );
    const mobileCheck = await runMobileHumanTest({
      simulatorUdid: simTarget?.simulatorUdid,
      bundleId: simTarget?.bundleId,
      runConfig,
      orchestrator
    });

    if (!mobileCheck.available) {
      orchestrator.log(
        'human',
        `Deploy mobile no Simulador — teste humano automatizado não rodou (${mobileCheck.skippedReason}).`,
        'warning'
      );
    }

    const humanReport = {
      passed: mobileCheck.ok,
      skipped: !mobileCheck.available,
      reason: mobileCheck.available
        ? null
        : mobileCheck.skippedReason || 'Deploy mobile (Simulador) não expõe URL HTTP.',
      issues: mobileCheck.issues || [],
      screenshots: mobileCheck.screenshots || []
    };
    orchestrator.currentTask.humanReport = humanReport;
    orchestrator.savedConfig = {
      ...orchestrator.savedConfig,
      humanReport,
      lastHumanReport: humanReport
    };
    orchestrator.persistTask({ config: orchestrator.savedConfig });
    orchestrator.broadcast('agent-finished', {
      agent: 'human',
      status: humanReport.passed ? 'success' : 'failed',
      data: humanReport
    });

    if (humanReport.passed) {
      await orchestrator.pauseForApproval(
        'prodReady',
        mobileCheck.available
          ? 'Teste humano no Simulador (Appium/XCUITest) aprovado. Aprove o checklist de produção.'
          : 'Deploy mobile no Simulador — teste humano automatizado não se aplica aqui. Aprove o checklist de produção.'
      );
      return;
    }

    const n = Array.isArray(humanReport.issues) ? humanReport.issues.length : 0;
    await orchestrator.pauseForApproval(
      'userFix',
      `Humano no Simulador (Appium/XCUITest) encontrou ${n} problema(s). Aprove o Corretor do Usuário (ou envie um relato próprio).`
    );
    return;
  }

  const human = require('../human');
  orchestrator.log('human', 'Iniciando teste humano in loco no deploy…', 'info');

  // O app implantado pode exigir uma credencial gerada pela própria forja (ex.: API_TOKEN
  // aleatório) — sem isso o "humano" só consegue inventar um valor plausível, que a API
  // corretamente rejeita, gerando um falso "problema" em cascata a cada ciclo.
  const deployedEnv = readDeployedEnv(runConfig);

  const humanReport = await human.execute(
    orchestrator.currentTask.deployUrl,
    orchestrator.currentTask.files,
    runConfig,
    orchestrator,
    deployedEnv
  );
  orchestrator.throwIfAborted();

  orchestrator.currentTask.humanReport = humanReport;
  orchestrator.savedConfig = {
    ...orchestrator.savedConfig,
    humanReport,
    lastHumanReport: humanReport
  };
  orchestrator.persistTask({
    config: orchestrator.savedConfig
  });
  orchestrator.broadcast('agent-finished', {
    agent: 'human',
    status: humanReport.passed ? 'success' : 'failed',
    data: humanReport
  });

  if (humanReport.passed) {
    await orchestrator.pauseForApproval(
      'prodReady',
      'Teste humano in loco aprovado. Aprove o checklist de produção (artefatos + gates finais).'
    );
    return;
  }

  const n = Array.isArray(humanReport.issues) ? humanReport.issues.length : 0;
  await orchestrator.pauseForApproval(
    'userFix',
    `Humano in loco encontrou ${n} problema(s) no fluxo. Aprove o Corretor do Usuário (ou envie um relato próprio).`
  );
}

module.exports = { run };
