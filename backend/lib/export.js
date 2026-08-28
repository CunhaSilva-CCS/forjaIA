const archiver = require('archiver');
const path = require('path');
const { runs } = require('./db');

function buildAdrMarkdown(adrs = []) {
  if (!adrs.length) return '# Architecture Decision Records\n\n_Nenhum ADR registrado._\n';
  return (
    '# Architecture Decision Records\n\n' +
    adrs
      .map(
        (a) => `## ${a.id}: ${a.title}\n\n**Status:** ${a.status || 'Proposed'}\n\n### Context\n${a.context || ''}\n\n### Decision\n${a.decision || ''}\n\n### Consequences\n${a.consequences || ''}\n`
      )
      .join('\n')
  );
}

async function streamRunExport(runId, res) {
  const run = runs.get(runId);
  if (!run) {
    res.status(404).json({ error: 'Execução não encontrada' });
    return;
  }

  const events = runs.listEvents(runId);

  await new Promise((resolve) => {
    // `throw` dentro de um listener de EventEmitter NÃO propaga pro try/catch da rota (server.js)
    // — vira uma exceção não tratada e derruba o processo inteiro do ForjaIA (sem
    // `uncaughtException` handler em lugar nenhum), matando todas as runs em andamento por causa
    // de um único download interrompido. Erro é tratado aqui dentro: loga, encerra a resposta se
    // ainda for possível, e resolve normalmente — nunca deixa escapar pro chamador.
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[export] falha ao gerar zip:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Falha ao gerar export' });
      } else if (!res.writableEnded) {
        res.destroy(err);
      }
      finish();
    });
    archive.on('end', finish);
    // Cliente fechou a conexão no meio do stream (aba fechada, rede caiu) — aborta o archiver em
    // vez de deixá-lo escrevendo pra um socket morto.
    res.on('close', () => {
      if (!settled) archive.abort();
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="forja-run-${runId}.zip"`);
    archive.pipe(res);

    archive.append(JSON.stringify({ id: run.id, prompt: run.prompt, status: run.status, deployUrl: run.deploy_url }, null, 2), {
      name: 'meta.json'
    });
    archive.append(buildAdrMarkdown(run.adrs || []), { name: 'ADRs.md' });
    archive.append(JSON.stringify(run.securityIssues || [], null, 2), { name: 'security.json' });
    archive.append(JSON.stringify(run.tests || [], null, 2), { name: 'tests.json' });
    archive.append(JSON.stringify(run.performanceMetrics || {}, null, 2), { name: 'metrics.json' });
    archive.append(
      events.map((e) => `[${e.created_at}] [${e.agent || '-'}] [${e.type}] ${e.message}`).join('\n'),
      { name: 'logs.txt' }
    );

    for (const file of run.files || []) {
      if (!file?.path) continue;
      // file.path vem de run.files no banco — não passa pela mesma checagem de traversal que
      // devops.js aplica ao ESCREVER em disco (writeSafely). Como nome de entrada de zip, um
      // path tipo "../../../etc/cron.d/x" seria embutido sem sanitização; quem extrai esse zip
      // com uma ferramenta ingênua/desatualizada (zip-slip clássico) escreveria fora do diretório
      // de destino. O ForjaIA em si não é afetado (só monta o zip, não extrai), mas é
      // defesa-em-profundidade pra quem baixa o export.
      const normalized = path.posix.normalize(String(file.path));
      if (normalized.startsWith('..') || normalized.startsWith('/')) {
        console.error(`[export] ignorando arquivo com path suspeito no zip: ${file.path}`);
        continue;
      }
      archive.append(file.content || '', { name: `code/${normalized}` });
    }

    archive.finalize();
  });
}

module.exports = { streamRunExport, buildAdrMarkdown };
