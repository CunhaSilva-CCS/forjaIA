#!/usr/bin/env node
/**
 * Dogfooding automático do ForjaIA (ver ADR-035): dispara uma forja real contra um projeto de
 * teste simples, aprova cada gate sozinho e escreve um relatório estruturado ao final — sem isso,
 * achar um bug como o do ADR-034 (QA reprovando código correto) dependia de alguém sentar e
 * assistir a run manualmente.
 *
 * Uso:
 *   node scripts/dogfood-forge.js
 *   node scripts/dogfood-forge.js --prompt "crie uma API de tarefas em Express com testes"
 *   node scripts/dogfood-forge.js --max-minutes 45 --poll-ms 4000
 *
 * Pra automatizar (cron, ex. toda segunda às 6h — o backend precisa estar rodando):
 *   0 6 * * 1 cd /caminho/do/ForjaIA && node scripts/dogfood-forge.js >> backend/data/dogfood.log 2>&1
 *
 * Saída: escreve backend/data/dogfood-reports/<timestamp>.json (+ .md legível) e termina com exit code
 * 1 se a run falhou/travou/teve teste reprovado — pra cron/launchd conseguirem sinalizar (e-mail,
 * `&&` num alerta) sem precisar abrir o JSON. Nunca inicia uma run se já existe uma em andamento —
 * não queremos atropelar um forja real de alguém.
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const DEFAULT_PROMPT =
  'Crie uma API REST simples de lista de tarefas (CRUD de tarefas: listar, criar, atualizar, deletar) em Node.js/Express, com validação de título obrigatório.';

function parseArgs(argv) {
  const args = { prompt: DEFAULT_PROMPT, pollMs: 5000, maxMinutes: 60, reportDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--prompt') args.prompt = argv[++i];
    else if (argv[i] === '--poll-ms') args.pollMs = Number(argv[++i]);
    else if (argv[i] === '--max-minutes') args.maxMinutes = Number(argv[++i]);
    else if (argv[i] === '--report-dir') args.reportDir = argv[++i];
  }
  return args;
}

function apiBase() {
  const port = process.env.PORT || 4000;
  return process.env.FORJA_DOGFOOD_API_BASE || `http://localhost:${port}`;
}

function authToken() {
  const token = process.env.FORJA_API_TOKEN;
  if (!token) throw new Error('FORJA_API_TOKEN não definido (.env) — necessário pra autenticar as chamadas.');
  return token;
}

async function apiFetch(method, urlPath, body) {
  const res = await fetch(`${apiBase()}${urlPath}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${authToken()}`
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const message = (data && data.error) || `${res.status} ${res.statusText}`;
    throw new Error(`${method} ${urlPath} -> ${message}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompletion({ pollMs, maxMinutes, onEvent }) {
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  let lastStatus = null;
  let approvals = 0;

  for (;;) {
    if (Date.now() > deadline) {
      await apiFetch('POST', '/api/agent/cancel').catch(() => {});
      return { outcome: 'timeout', approvals };
    }

    const status = await apiFetch('GET', '/api/agent/status');
    const task = status.task;
    if (!task) return { outcome: 'no-task', approvals };

    if (task.status !== lastStatus) {
      lastStatus = task.status;
      onEvent(`status=${task.status} isExecuting=${status.isExecuting}`);
    }

    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      return { outcome: task.status, approvals, runId: task.id };
    }

    if (task.status === 'awaiting_approval' && !status.isExecuting) {
      approvals += 1;
      onEvent(`aprovando gate #${approvals}: ${task.approvalMessage || '(sem mensagem)'}`);
      await apiFetch('POST', '/api/agent/approve', { config: {} });
    }

    await sleep(pollMs);
  }
}

function summarizeTests(run) {
  const tests = run?.tests;
  if (!tests || !Array.isArray(tests)) return { total: 0, passed: 0 };
  return { total: tests.length, passed: tests.filter((t) => t.passed).length, failing: tests.filter((t) => !t.passed) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const log = (msg) => console.log(`[dogfood ${new Date().toISOString()}] ${msg}`);

  const initial = await apiFetch('GET', '/api/agent/status');
  if (initial.isExecuting || initial.task?.status === 'awaiting_approval') {
    log('já existe uma run em andamento — abortando pra não atropelar trabalho real.');
    process.exit(2);
  }

  log(`iniciando forja: "${args.prompt}"`);
  await apiFetch('POST', '/api/agent/run', {
    prompt: args.prompt,
    config: { mode: 'forge', environment: 'local' }
  });

  const result = await waitForCompletion({
    pollMs: args.pollMs,
    maxMinutes: args.maxMinutes,
    onEvent: log
  });

  let run = null;
  let opsHealth = null;
  if (result.runId) {
    run = await apiFetch('GET', `/api/runs/${result.runId}`).catch((err) => ({ error: err.message }));
  }
  opsHealth = await apiFetch('GET', '/api/ops/health').catch((err) => ({ error: err.message }));

  const finishedAt = new Date();
  const tests = summarizeTests(run);
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    prompt: args.prompt,
    runId: result.runId || null,
    outcome: result.outcome,
    approvals: result.approvals,
    tests,
    securityIssues: run?.securityIssues || null,
    reliability: run?.reliability || null,
    opsHealth,
    runError: run?.error || null
  };

  const reportDir = args.reportDir || path.join(__dirname, '../backend/data/dogfood-reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(reportDir, `${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const mdLines = [
    `# Dogfood ForjaIA — ${startedAt.toISOString()}`,
    '',
    `- Resultado: **${report.outcome}**`,
    `- Run: ${report.runId || '(nenhuma)'}`,
    `- Duração: ${Math.round(report.durationMs / 1000)}s`,
    `- Gates aprovados automaticamente: ${report.approvals}`,
    `- Testes: ${tests.passed ?? 0}/${tests.total ?? 0}`,
    report.securityIssues ? `- Achados de segurança: ${JSON.stringify(report.securityIssues)}` : '',
    report.runError ? `- Erro da run: ${report.runError}` : '',
    tests.failing?.length
      ? `\n## Testes reprovados\n${tests.failing.map((t) => `- ${t.name}: ${t.error}`).join('\n')}`
      : ''
  ].filter(Boolean);
  const mdPath = path.join(reportDir, `${stamp}.md`);
  fs.writeFileSync(mdPath, mdLines.join('\n') + '\n');

  log(`relatório: ${jsonPath}`);
  log(`resultado=${report.outcome} testes=${tests.passed ?? 0}/${tests.total ?? 0} aprovações=${report.approvals}`);

  const ok = report.outcome === 'completed' && (tests.total === 0 || tests.passed === tests.total);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`[dogfood] erro fatal: ${err.message}`);
  process.exit(1);
});
