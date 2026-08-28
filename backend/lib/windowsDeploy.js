/**
 * "Deploy" Windows via GitHub Actions (ver ADR-018) — não existe jeito de compilar um app nativo
 * Windows (react-native-windows) a partir de um Mac; cross-compilação pra esse alvo não existe.
 * O caminho real é um runner `windows-latest` do GitHub Actions, que tem Visual Studio de
 * verdade. ForjaIA dispara o workflow e acompanha o resultado via `gh` — não "abre na tela" como
 * o Simulador/Catalyst; o resultado é um build que passou ou falhou, com link pro artefato.
 * Só funciona em projetos que já têm a pasta `windows/` (react-native-windows-init) e o workflow
 * commitados — ForjaIA não cria esse scaffolding sozinho a cada deploy (é uma decisão de
 * configuração única do projeto, não uma etapa repetível de pipeline).
 */
const fs = require('fs');
const path = require('path');
const { execAsync } = require('./dockerBuild');

const WORKFLOW_FILE = 'windows-build.yml';
const POLL_INTERVAL_MS = Number(process.env.FORJA_WINDOWS_POLL_MS || 10000);
const MAX_WAIT_MS = Number(process.env.FORJA_WINDOWS_MAX_WAIT_MS || 20 * 60 * 1000);
const REGISTER_DELAY_MS = Number(process.env.FORJA_WINDOWS_REGISTER_DELAY_MS || 5000);

function supportsWindows(projectDir) {
  return (
    fs.existsSync(path.join(projectDir, 'windows')) &&
    fs.existsSync(path.join(projectDir, '.github', 'workflows', WORKFLOW_FILE))
  );
}

async function triggerWindowsBuild({ projectDir, orchestrator }) {
  if (!supportsWindows(projectDir)) {
    throw new Error('Projeto sem suporte a Windows configurado (pasta windows/ ou workflow ausente).');
  }

  orchestrator.log('devops', 'Disparando build Windows no GitHub Actions (windows-latest)...', 'info');
  await execAsync(`gh workflow run ${WORKFLOW_FILE}`, { cwd: projectDir });

  // Dá tempo do GitHub registrar o run novo antes de listar — disparo e listagem não são atômicos.
  await new Promise((resolve) => setTimeout(resolve, REGISTER_DELAY_MS));

  const { stdout: listOut } = await execAsync(
    `gh run list --workflow=${WORKFLOW_FILE} --limit 1 --json databaseId,status,url`,
    { cwd: projectDir }
  );
  const runs = JSON.parse(listOut);
  if (!runs.length) {
    throw new Error('Não encontrei o run disparado no GitHub Actions (gh run list veio vazio).');
  }
  const runId = runs[0].databaseId;
  orchestrator.log('devops', `Build Windows disparado (run ${runId}) — acompanhando...`, 'info');

  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const { stdout } = await execAsync(`gh run view ${runId} --json status,conclusion,url`, { cwd: projectDir });
    const info = JSON.parse(stdout);
    if (info.status === 'completed') {
      if (info.conclusion !== 'success') {
        const err = new Error(`Build Windows falhou no GitHub Actions (${info.conclusion}): ${info.url}`);
        err.runUrl = info.url;
        throw err;
      }
      orchestrator.log('devops', `Build Windows concluído com sucesso: ${info.url}`, 'success');
      return { type: 'windows-ci', url: null, runId, runUrl: info.url };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Build Windows não terminou em ${MAX_WAIT_MS / 60000} minutos — acompanhe manualmente no GitHub Actions.`);
}

module.exports = { supportsWindows, triggerWindowsBuild, WORKFLOW_FILE };
