/**
 * Agente Reporter — monta relatório detalhado da execução (QA, Segurança, DevOps, humano, prod).
 */
const fs = require('fs');
const path = require('path');
const config = require('../lib/config');
const { buildReportPdf } = require('../lib/reportPdf');

/**
 * _reports/ vive DENTRO da pasta do projeto ao qual a run pertence, nunca solto na raiz do
 * workspace — senão relatórios de projetos diferentes (inclusive de terceiros, se o workspace for
 * compartilhado) se misturam no mesmo lugar. Sem targetPath/sourcePath resolvível (run muito cedo
 * no pipeline, ou caminho fora do workspace), cai pro antigo comportamento de raiz compartilhada
 * como último recurso — nunca falha a geração do relatório por causa disso.
 */
function ensureReportsDir(run) {
  const projectPath = run?.config?.targetPath || run?.config?.sourcePath || null;
  if (projectPath) {
    try {
      const { resolveWithinWorkspace } = require('../lib/paths');
      const dir = path.join(resolveWithinWorkspace(projectPath), '_reports');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // caminho inválido/fora do workspace → cai pro fallback abaixo
    }
  }
  const dir = path.join(config.workspaceRoot, '_reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function summarizeEvents(events = []) {
  const byAgent = {};
  for (const e of events) {
    const agent = e.agent || 'sistema';
    if (!byAgent[agent]) byAgent[agent] = { info: 0, success: 0, warning: 0, error: 0, messages: [] };
    const bucket = byAgent[agent];
    const t = e.type || 'info';
    if (bucket[t] !== undefined) bucket[t] += 1;
    else bucket.info += 1;
    // Mantém amostra ampla no PDF detalhado (não só 8).
    if (bucket.messages.length < 40) {
      bucket.messages.push({ type: t, message: e.message, at: e.created_at });
    }
  }
  return byAgent;
}

function pickHuman(run) {
  return (
    run.humanReport ||
    run.config?.humanReport ||
    run.config?.lastHumanReport ||
    null
  );
}

function pickProd(run) {
  return (
    run.productionReady ||
    run.config?.productionReady ||
    run.config?.lastProductionReady ||
    null
  );
}

function pickDiagnosis(run) {
  return run.diagnosis || run.config?.lastDiagnosis || null;
}

function pickOwner(run) {
  if (run.owner && (run.owner.name || run.owner.id)) return run.owner;
  if (run.owner_name || run.owner_id) {
    return {
      id: run.owner_id || null,
      name: run.owner_name || run.owner_id || '—',
      role: run.owner_role || null
    };
  }
  if (run.config?.owner) return run.config.owner;
  return null;
}

function buildNarrative(run, events) {
  const tests = run.tests || [];
  const passed = tests.filter((t) => t.passed).length;
  const failed = tests.length - passed;
  const issues = run.securityIssues || [];
  const critical = issues.filter((i) => /critical|alta|high/i.test(i.severity || '')).length;
  const metrics = run.performanceMetrics || {};
  const mode = run.config?.mode === 'validate' ? 'validação de projeto existente' : 'forja completa';
  const env = run.environment || run.config?.environment || 'local';
  const human = pickHuman(run);
  const prod = pickProd(run);
  const diagnosis = pickDiagnosis(run);

  const lines = [];
  lines.push(
    `Este relatório detalhado foi gerado automaticamente pelo agente Reporter do ForjaIA após a ${mode} no ambiente "${env}".`
  );
  lines.push(
    `A execução "${run.prompt}" (run ${run.id}) terminou com status ${String(run.status || '').toUpperCase()}.`
  );

  const owner = pickOwner(run);
  if (owner?.name) {
    lines.push(`Owner responsável: ${owner.name}${owner.role ? ` (${owner.role})` : ''}.`);
  }

  if (tests.length) {
    lines.push(
      `Na fase de QA foram executados ${tests.length} casos de teste: ${passed} aprovados e ${failed} reprovados.`
    );
    if (failed === 0) {
      lines.push('A suíte funcional passou integralmente.');
    } else {
      const names = tests
        .filter((t) => !t.passed)
        .map((t) => t.name)
        .join(', ');
      lines.push(`Falhas observadas em: ${names}.`);
    }
  } else {
    lines.push('Nenhum caso de teste QA foi registrado nesta execução.');
  }

  if (issues.length === 0) {
    lines.push(
      'A varredura de segurança (análise estática + dinâmicas) não identificou vulnerabilidades críticas ou médias.'
    );
  } else {
    lines.push(
      `A segurança reportou ${issues.length} achado(s), sendo ${critical} de severidade alta/crítica.`
    );
    const tops = issues
      .slice(0, 5)
      .map((i) => `${i.title || i.type || i.id} [${i.severity || 'n/d'}]`)
      .join('; ');
    if (tops) lines.push(`Principais achados: ${tops}.`);
  }

  if (diagnosis?.summary) {
    lines.push(
      `Diagnóstico do depurador (severidade ${diagnosis.severity || 'n/d'}): ${diagnosis.summary}`
    );
  }

  if (metrics && metrics.totalRequests) {
    lines.push(
      `Os testes de carga com engenharia do caos dispararam ${metrics.totalRequests} requisições ` +
        `(${metrics.rps} RPS, latência média ${metrics.avgLatency} ms` +
        (metrics.p95Latency != null ? `, p95 ${metrics.p95Latency} ms` : '') +
        `, taxa de sucesso ${metrics.successRate}%).`
    );
    if (metrics.chaosMode) {
      lines.push(`Modo de caos utilizado: ${metrics.chaosMode}.`);
    }
  }

  if (run.deploy_url || run.deployUrl) {
    lines.push(
      `O DevOps concluiu o deploy em ${run.deploy_url || run.deployUrl}` +
        (run.deployRuntime || run.config?.deployRuntime
          ? ` (runtime ${run.deployRuntime || run.config.deployRuntime})`
          : '') +
        '.'
    );
  }

  if (human) {
    const stepCount = human.session?.steps?.length || 0;
    const issueCount = human.issues?.length || 0;
    lines.push(
      human.passed
        ? `O teste humano in loco (persona ${human.session?.persona || 'usuário'}) validou o fluxo principal em ${stepCount} passo(s).`
        : `O teste humano in loco reprovou o fluxo (${issueCount} achado(s) em ${stepCount} passo(s)): ${human.notesForUserFix || human.seniorReview?.summary || 'ver seção dedicada'}.`
    );
  }

  if (prod) {
    const okCount = (prod.checks || []).filter((c) => c.ok).length;
    const total = (prod.checks || []).length;
    lines.push(
      prod.ready
        ? `Checklist de produção aprovado (${okCount}/${total}). O software está pronto para produção.`
        : `Checklist de produção bloqueou a liberação (${okCount}/${total} ok): ${prod.summary || ''}`
    );
  }

  const branch = run.git_branch || run.gitBranch || run.config?.gitBranch;
  const pr = run.pr_url || run.prUrl || run.config?.prUrl;
  if (branch || pr) {
    lines.push(
      `Release git: branch ${branch || 'n/d'}${pr ? `; PR ${pr}` : ''}.`
    );
  }

  if (run.error) {
    lines.push(`Observação de erro registrada: ${run.error}.`);
  }

  const byAgent = {};
  for (const e of events || []) {
    const a = e.agent || 'sistema';
    byAgent[a] = (byAgent[a] || 0) + 1;
  }
  const agentBits = Object.entries(byAgent)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  lines.push(
    `Linha do tempo: ${events?.length || 0} eventos no pipeline${agentBits ? ` (${agentBits})` : ''}.`
  );

  lines.push(
    prod?.ready || run.config?.productionReadyFlag
      ? 'Conclusão: o projeto foi liberado como pronto para produção sob critérios de qualidade, segurança, resiliência, teste humano in loco e checklist operacional ForjaIA. Detalhes completos nas seções seguintes deste PDF.'
      : 'Conclusão: o projeto foi avaliado sob critérios de qualidade funcional, segurança e resiliência operacional — padrão Engenheiro Sênior ForjaIA. Detalhes completos nas seções seguintes deste PDF.'
  );

  return lines.join(' ');
}

async function buildNarrativeSenior(run, events, orchestrator) {
  const fallback = buildNarrative(run, events);
  if (!orchestrator) return fallback;

  const { thinkAsSenior } = require('../lib/seniorEngineer');
  const human = pickHuman(run);
  const prod = pickProd(run);
  const senior = await thinkAsSenior({
    role: 'reporter',
    taskContract: `Escreva a narrativa executiva do relatório técnico DETALHADO como um sênior.
Tom claro, factual, sem marketing. 10-16 frases em português cobrindo: contexto, QA, segurança,
diagnóstico (se houver), carga, deploy/ambiente, teste humano in loco, checklist de produção,
git/PR (se houver) e conclusão.
Retorne APENAS JSON: { "narrative": "texto contínuo" }`,
    userPayload: {
      prompt: run.prompt,
      status: run.status,
      mode: run.config?.mode,
      environment: run.environment || run.config?.environment,
      owner: pickOwner(run),
      tests: run.tests,
      securityIssues: run.securityIssues,
      diagnosis: pickDiagnosis(run),
      performanceMetrics: run.performanceMetrics,
      deployUrl: run.deploy_url || run.deployUrl,
      humanPassed: human?.passed,
      humanIssues: human?.issues,
      productionReady: prod,
      gitBranch: run.git_branch || run.gitBranch,
      prUrl: run.pr_url || run.prUrl,
      error: run.error,
      heuristicNarrative: fallback
    },
    runConfig: run.config || {},
    orchestrator
  });

  if (senior?.narrative && String(senior.narrative).trim().length > 40) {
    return String(senior.narrative).trim();
  }
  return fallback;
}

function projectNameFromRun(run) {
  const cfg = run.config || {};
  const raw =
    cfg.targetPath ||
    cfg.sourcePath ||
    run.projectName ||
    run.project_path ||
    (typeof run.prompt === 'string' && run.prompt.includes(':')
      ? run.prompt.split(':').slice(1).join(':').trim()
      : null) ||
    'projeto';
  const base = String(raw).split(/[/\\]/).filter(Boolean).pop() || 'projeto';
  return (
    base
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'projeto'
  );
}

function buildReportModel(run, events = [], narrativeOverride = null) {
  const tests = run.tests || [];
  const passed = tests.filter((t) => t.passed).length;
  const projectName = projectNameFromRun(run);
  const human = pickHuman(run);
  const prod = pickProd(run);
  const prodChecks = prod?.checks || [];
  const files = (run.files || []).map((f) =>
    typeof f === 'string'
      ? { path: f }
      : { path: f.path || f.name || String(f), content: f.content }
  );

  return {
    generatedAt: new Date().toISOString(),
    title: 'Relatório Detalhado de Testes e Validação — ForjaIA',
    projectName,
    runId: run.id,
    prompt: run.prompt,
    status: run.status,
    mode: run.config?.mode || 'forge',
    environment: run.environment || run.config?.environment || 'local',
    sourcePath: run.config?.sourcePath || run.config?.targetPath || null,
    owner: pickOwner(run),
    startedAt: run.started_at || run.startTime,
    finishedAt: run.finished_at || run.finishedAt,
    deployUrl: run.deploy_url || run.deployUrl || null,
    deployRuntime: run.deployRuntime || run.config?.deployRuntime || null,
    gitBranch: run.git_branch || run.gitBranch || run.config?.gitBranch || null,
    prUrl: run.pr_url || run.prUrl || run.config?.prUrl || null,
    error: run.error || null,
    pdfPath: run.reportPdfPath || null,
    productionReady: prod,
    productionReadyFlag: Boolean(run.config?.productionReadyFlag || prod?.ready),
    humanReport: human,
    diagnosis: pickDiagnosis(run),
    narrative: narrativeOverride || buildNarrative(run, events),
    summary: {
      testsTotal: tests.length,
      testsPassed: passed,
      testsFailed: tests.length - passed,
      securityIssues: (run.securityIssues || []).length,
      files: files.length,
      events: events.length,
      productionReady: Boolean(run.config?.productionReadyFlag || prod?.ready),
      humanPassed: human ? Boolean(human.passed) : null,
      prodChecksOk: prodChecks.filter((c) => c.ok).length,
      prodChecksTotal: prodChecks.length
    },
    tests,
    securityIssues: run.securityIssues || [],
    performanceMetrics: run.performanceMetrics || null,
    adrs: run.adrs || [],
    files,
    tokenStats: run.tokenStats || run.token_stats || null,
    agentBreakdown: summarizeEvents(events),
    timeline: (events || []).map((e) => ({
      at: e.created_at,
      agent: e.agent || 'sistema',
      type: e.type || 'info',
      message: e.message
    }))
  };
}

async function generatePdfForRun(run, events = [], orchestrator = null) {
  const narrative = await buildNarrativeSenior(run, events, orchestrator);
  const model = buildReportModel(run, events, narrative);
  const dir = ensureReportsDir(run);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const outPath = path.join(dir, `relatorio-${model.projectName}-${stamp}.pdf`);
  model.pdfPath = outPath;
  await buildReportPdf(model, outPath);
  return { path: outPath, model };
}

module.exports = {
  buildReportModel,
  buildNarrative,
  buildNarrativeSenior,
  generatePdfForRun,
  ensureReportsDir,
  projectNameFromRun
};
