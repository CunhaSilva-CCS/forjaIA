const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const config = require('./config');

const execFileAsync = promisify(execFile);

async function run(cmd, args, cwd) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    env: process.env,
    maxBuffer: 5 * 1024 * 1024
  });
  return { stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() };
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

/**
 * Publica o resultado da forja em branch + PR (quando gh estiver disponível).
 * Soft-fail por padrão; hard-fail se FORJA_REQUIRE_GIT_PR=true.
 */
async function publishRelease({
  projectDir,
  runId,
  prompt,
  productionReady,
  deployUrl,
  environment,
  orchestrator
} = {}) {
  const requirePr = config.requireGitPr;
  const log = (msg, type = 'info') => orchestrator?.log?.('orchestrator', msg, type);

  if (!projectDir || !fs.existsSync(projectDir)) {
    const msg = 'Git release: diretório do projeto ausente';
    if (requirePr) throw new Error(msg);
    log(msg, 'warning');
    return { ok: false, skipped: true, reason: msg };
  }

  try {
    if (!isGitRepo(projectDir)) {
      log('Git release: inicializando repositório local…', 'info');
      await run('git', ['init'], projectDir);
      await run('git', ['add', '-A'], projectDir);
      try {
        await run('git', ['commit', '-m', 'chore: initial forja snapshot'], projectDir);
      } catch {
        // maybe empty
      }
    }

    const branch = `forja/${String(runId || 'run').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48)}`;
    try {
      await run('git', ['checkout', '-B', branch], projectDir);
    } catch (err) {
      throw new Error(`git checkout falhou: ${err.message}`);
    }

    await run('git', ['add', '-A'], projectDir);
    const status = await run('git', ['status', '--porcelain'], projectDir);
    if (status.stdout) {
      const msg = `forja: run ${runId} pronto para produção (${environment || 'local'})`;
      await run('git', ['commit', '-m', msg], projectDir);
      log(`Git: commit na branch ${branch}`, 'success');
    } else {
      log('Git: nada novo para commitar', 'info');
    }

    let prUrl = null;
    let pushed = false;
    try {
      await run('git', ['push', '-u', 'origin', branch], projectDir);
      pushed = true;
      log(`Git: push origin ${branch}`, 'success');
    } catch (err) {
      log(`Git push indisponível (${err.message}). Branch local: ${branch}`, 'warning');
    }

    if (pushed) {
      try {
        const body = [
          `## ForjaIA — release automática`,
          ``,
          `- Run: \`${runId}\``,
          `- Ambiente: \`${environment || 'local'}\``,
          `- Deploy: ${deployUrl || 'n/a'}`,
          `- Checklist: ${productionReady?.ready ? 'OK' : 'n/a'}`,
          ``,
          `### Prompt`,
          String(prompt || '').slice(0, 500),
          ``,
          `### Checklist`,
          ...(productionReady?.checks || []).map(
            (c) => `- [${c.ok ? 'x' : ' '}] ${c.title}: ${c.detail}`
          )
        ].join('\n');

        const pr = await run(
          'gh',
          ['pr', 'create', '--title', `forja: ${String(prompt || runId).slice(0, 72)}`, '--body', body, '--head', branch],
          projectDir
        );
        prUrl = pr.stdout.split('\n').find((l) => l.includes('http')) || pr.stdout || null;
        log(`PR criado: ${prUrl || '(sem URL)'}`, 'success');
      } catch (err) {
        log(`gh pr create indisponível (${err.message})`, 'warning');
        if (requirePr) throw new Error(`FORJA_REQUIRE_GIT_PR: falha ao criar PR (${err.message})`);
      }
    } else if (requirePr) {
      throw new Error('FORJA_REQUIRE_GIT_PR: push para origin é obrigatório');
    }

    return { ok: true, branch, prUrl, pushed };
  } catch (err) {
    if (requirePr) throw err;
    log(`Git release soft-fail: ${err.message}`, 'warning');
    return { ok: false, error: err.message };
  }
}

module.exports = { publishRelease, isGitRepo };
