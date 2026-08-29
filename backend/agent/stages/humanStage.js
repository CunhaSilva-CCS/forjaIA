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

  // Deploy mobile (Simulador/Emulador) não tem URL HTTP — o teste humano via fetch não se aplica
  // (ver ADR-014). Em vez disso tenta um teste real via Appium (ADR-029/031) contra CADA app já
  // instalado (iOS e/ou Android — os dois podem ter tido sucesso no mesmo deploy multi-plataforma,
  // ver ADR-018); se não houver servidor Appium disponível no ambiente, degrada pro mesmo "skipped"
  // explícito de antes em vez de travar ou inventar resultado.
  const { detectProjectType } = require('../../lib/projectType');
  if (detectProjectType(orchestrator.currentTask.files) === 'mobile-expo') {
    const { runMobileHumanTest } = require('../../lib/mobileHumanTest');
    // Fallback pro savedConfig (mesmo padrão de emitReportPdf) — restorePendingApproval já
    // restaura deployTargets em currentTask explicitamente, mas esse fallback é defesa em
    // profundidade caso um caminho futuro reconstrua currentTask sem passar por lá.
    const deployTargets = orchestrator.currentTask.deployTargets || orchestrator.savedConfig?.deployTargets || [];
    const iosTarget = deployTargets.find((t) => t.platform === 'ios-simulator' && t.ok);
    const androidTarget = deployTargets.find((t) => t.platform === 'android-emulator' && t.ok);

    const checks = [];
    if (iosTarget) {
      checks.push({
        platform: 'ios',
        result: await runMobileHumanTest({
          platform: 'ios',
          simulatorUdid: iosTarget.simulatorUdid,
          bundleId: iosTarget.bundleId,
          runConfig,
          orchestrator
        })
      });
    }
    if (androidTarget) {
      checks.push({
        platform: 'android',
        result: await runMobileHumanTest({
          platform: 'android',
          emulatorSerial: androidTarget.emulatorSerial,
          androidPackage: androidTarget.androidPackage,
          runConfig,
          orchestrator
        })
      });
    }
    if (!checks.length) {
      // Nenhum alvo mobile teve deploy bem-sucedido — mesmo shape de "não disponível" de antes,
      // só que agora cobrindo o caso de os dois (iOS e Android) terem falhado no deployStage.
      checks.push({
        platform: 'ios',
        result: {
          available: false,
          ok: true,
          skippedReason: 'nenhum alvo mobile (Simulador/Emulador) teve deploy bem-sucedido nesta run.',
          issues: [],
          screenshots: []
        }
      });
    }

    const anyAvailable = checks.some((c) => c.result.available);
    const allOk = checks.every((c) => c.result.ok);
    const mergedIssues = checks.flatMap((c) => c.result.issues || []);
    const mergedScreenshots = checks.flatMap((c) => c.result.screenshots || []);

    if (!anyAvailable) {
      const reasons = checks.map((c) => `${c.platform}: ${c.result.skippedReason}`).join(' | ');
      orchestrator.log('human', `Deploy mobile — teste humano automatizado não rodou (${reasons}).`, 'warning');
    }

    const humanReport = {
      passed: allOk,
      skipped: !anyAvailable,
      reason: anyAvailable ? null : checks.map((c) => c.result.skippedReason).filter(Boolean).join(' | ') || 'Deploy mobile não expõe URL HTTP.',
      issues: mergedIssues,
      screenshots: mergedScreenshots
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

    const platformsChecked = checks.map((c) => c.platform).join('+');
    if (humanReport.passed) {
      await orchestrator.pauseForApproval(
        'prodReady',
        anyAvailable
          ? `Teste humano no(s) ${platformsChecked} (Appium) aprovado. Aprove o checklist de produção.`
          : 'Deploy mobile — teste humano automatizado não se aplica aqui. Aprove o checklist de produção.'
      );
      return;
    }

    const n = Array.isArray(humanReport.issues) ? humanReport.issues.length : 0;
    await orchestrator.pauseForApproval(
      'userFix',
      `Humano no(s) ${platformsChecked} (Appium) encontrou ${n} problema(s). Aprove o Corretor do Usuário (ou envie um relato próprio).`
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
