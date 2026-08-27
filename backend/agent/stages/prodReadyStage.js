async function run(orchestrator, runConfig) {
  orchestrator.throwIfAborted();
  const { resolveWithinWorkspace } = require('../../lib/paths');
  const { evaluateProductionReady } = require('../../lib/productionChecklist');
  const { announceThinking } = require('../../lib/seniorEngineer');

  orchestrator.broadcast('agent-active', { agent: 'devops' });
  announceThinking(orchestrator, 'devops');
  orchestrator.log('orchestrator', 'Executando checklist de prontidão para produção…', 'info');

  const relativeTarget =
    runConfig.targetPath ||
    runConfig.sourcePath ||
    orchestrator.savedConfig?.targetPath ||
    orchestrator.savedConfig?.sourcePath ||
    'deployed';
  const deployDir = resolveWithinWorkspace(relativeTarget);

  const result = await evaluateProductionReady({
    deployDir,
    deployUrl: orchestrator.currentTask.deployUrl,
    relativeTarget,
    task: orchestrator.currentTask,
    writeArtifacts: true
  });
  orchestrator.throwIfAborted();

  if (result.artifactsWritten?.length) {
    const byPath = new Map((orchestrator.currentTask.files || []).map((f) => [f.path, f]));
    for (const file of result.artifactsWritten) {
      byPath.set(file.path, {
        name: file.path.split('/').pop(),
        path: file.path,
        content: file.content
      });
    }
    orchestrator.currentTask.files = [...byPath.values()];
    orchestrator.saveFileVersions(result.artifactsWritten);
    orchestrator.log(
      'orchestrator',
      `Artefatos de produção gravados: ${result.artifactsWritten.map((f) => f.path).join(', ')}`,
      'info'
    );
  }

  orchestrator.currentTask.productionReady = result;
  orchestrator.savedConfig = {
    ...orchestrator.savedConfig,
    productionReady: result,
    lastProductionReady: result
  };
  orchestrator.persistTask({ files: orchestrator.currentTask.files, config: orchestrator.savedConfig });

  for (const check of result.checks || []) {
    orchestrator.log(
      'orchestrator',
      `[prod] ${check.ok ? 'OK' : 'FAIL'} ${check.title}: ${check.detail}`,
      check.ok ? 'success' : 'warning'
    );
  }

  orchestrator.broadcast('agent-finished', {
    agent: 'devops',
    status: result.ready ? 'success' : 'failed',
    data: { productionReady: result }
  });

  if (result.ready) {
    orchestrator.log('orchestrator', result.summary, 'success');

    try {
      const { publishRelease } = require('../../lib/gitRelease');
      const git = await publishRelease({
        projectDir: deployDir,
        runId: orchestrator.currentTask.id,
        prompt: orchestrator.savedPrompt || orchestrator.currentTask.prompt,
        productionReady: result,
        deployUrl: orchestrator.currentTask.deployUrl,
        environment: orchestrator.savedConfig?.environment || orchestrator.currentTask.environment || 'local',
        orchestrator
      });
      if (git?.branch || git?.prUrl) {
        orchestrator.savedConfig = {
          ...orchestrator.savedConfig,
          gitBranch: git.branch || null,
          prUrl: git.prUrl || null
        };
        orchestrator.persistTask({
          config: orchestrator.savedConfig,
          gitBranch: git.branch || null,
          prUrl: git.prUrl || null
        });
      }
    } catch (gitErr) {
      orchestrator.log('orchestrator', `Git/PR: ${gitErr.message}`, 'warning');
    }

    await orchestrator.pauseForApproval(
      'report',
      'Checklist de produção OK — software pronto para produção. Aprove para gerar o relatório PDF final.'
    );
    return;
  }

  orchestrator.savedConfig = {
    ...orchestrator.savedConfig,
    userReport:
      orchestrator.savedConfig?.userReport ||
      `Checklist de produção falhou:\n${(result.issues || [])
        .map((i) => `- [${i.severity}] ${i.title}: ${i.description}`)
        .join('\n')}`
  };
  await orchestrator.pauseForApproval(
    'userFix',
    `${result.summary} Aprove o Corretor para fechar os gaps e retornar ao QA/deploy.`
  );
}

module.exports = { run };
