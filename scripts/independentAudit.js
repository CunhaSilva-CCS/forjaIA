#!/usr/bin/env node
/**
 * CLI da auditoria independente (Semgrep + npm audit, ver ADR-021) — roda direto, sem precisar do
 * servidor do ForjaIA no ar. Uso:
 *   node scripts/independentAudit.js --target self
 *   node scripts/independentAudit.js --target project --path /caminho/do/projeto
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

function parseArgs(argv) {
  const args = { target: 'self', path: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--path') args.path = argv[++i];
  }
  return args;
}

function severityRank(sev) {
  const order = { CRITICAL: 0, HIGH: 1, MODERATE: 2, MEDIUM: 2, LOW: 3, INFO: 4 };
  return order[String(sev || '').toUpperCase()] ?? 5;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['self', 'project'].includes(args.target)) {
    console.error('--target precisa ser "self" ou "project"');
    process.exit(2);
  }
  if (args.target === 'project' && !args.path) {
    console.error('--target project exige --path /caminho/do/projeto');
    process.exit(2);
  }

  const { runIndependentAudit, resolveSelfTargetDir, checkSemgrepAvailable } = require('../backend/lib/independentAudit');
  const targetDir = args.target === 'self' ? resolveSelfTargetDir() : path.resolve(args.path);

  const semgrepOk = await checkSemgrepAvailable();
  console.log(`Alvo: ${args.target} (${targetDir})`);
  console.log(`Semgrep disponível: ${semgrepOk ? 'sim' : 'não (brew install semgrep ou pip install semgrep)'}`);
  console.log('Rodando auditoria (Semgrep pode levar dezenas de segundos na primeira vez)...\n');

  const result = await runIndependentAudit({ target: args.target, targetDir });

  const sorted = [...result.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  for (const f of sorted) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`[${f.severity}] ${f.title}\n  ${loc}\n`);
  }

  console.log('---');
  console.log(`Resumo: ${result.summary}`);
  if (!result.tools.semgrep.available) {
    console.log(`(semgrep pulado: ${result.tools.semgrep.skippedReason})`);
  }

  const hasBlocking = result.findings.some((f) => ['CRITICAL', 'HIGH'].includes(String(f.severity).toUpperCase()));
  process.exit(hasBlocking ? 1 : 0);
}

main().catch((err) => {
  console.error('Falha na auditoria:', err.message);
  process.exit(2);
});
