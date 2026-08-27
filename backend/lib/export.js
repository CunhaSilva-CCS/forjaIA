const archiver = require('archiver');
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
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="forja-run-${runId}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    throw err;
  });
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
    archive.append(file.content || '', { name: `code/${file.path}` });
  }

  await archive.finalize();
}

module.exports = { streamRunExport, buildAdrMarkdown };
