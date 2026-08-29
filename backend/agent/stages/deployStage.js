/** Descreve onde o deploy foi feito, cobrindo tanto o web/simulador único de antes quanto os
 * múltiplos alvos mobile (ADR-018: Simulador + Mac Catalyst + Windows via GitHub Actions). */
function describeDeployTargets(deployResult) {
  if (deployResult.url) return deployResult.url;
  if (Array.isArray(deployResult.targets) && deployResult.targets.length) {
    const parts = deployResult.targets.map((t) => {
      if (t.platform === 'ios-simulator') return t.ok ? `Simulador (${t.simulatorName || 'iPhone'})` : null;
      if (t.platform === 'macos') return t.ok ? 'macOS (Catalyst)' : 'macOS (falhou)';
      if (t.platform === 'windows') return t.ok ? `Windows (${t.runUrl || 'GitHub Actions'})` : 'Windows (falhou)';
      return null;
    });
    return parts.filter(Boolean).join(' · ') || 'destino desconhecido';
  }
  return `Simulador (${deployResult.simulatorName || 'iPhone'})`;
}

async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const devops = require('../devops');
  orchestrator.broadcast('agent-active', { agent: 'devops' });
  orchestrator.log('devops', 'Preparando deploy local final...', 'info');
  const deployResult = await devops.deploy(orchestrator.currentTask.files, runConfig, orchestrator);
  orchestrator.throwIfAborted();
  orchestrator.currentTask.deployUrl = deployResult.url;
  orchestrator.currentTask.deployTargets = deployResult.targets || null;
  orchestrator.savedConfig = { ...orchestrator.savedConfig, deployTargets: orchestrator.currentTask.deployTargets };
  orchestrator.persistTask({ deployUrl: deployResult.url });
  const where = describeDeployTargets(deployResult);
  orchestrator.log('orchestrator', `Projeto implantado em ${where}`, 'success');
  orchestrator.broadcast('agent-finished', { agent: 'devops', status: 'success', data: deployResult });
  await orchestrator.pauseForApproval(
    'human',
    `Deploy em ${where}. Aprove o teste humano in loco (fluxo e funcionamento).`
  );
}

module.exports = { run };
