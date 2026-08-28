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
  const human = require('../human');
  orchestrator.broadcast('agent-active', { agent: 'human' });
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
