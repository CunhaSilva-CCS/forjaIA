const fs = require('fs');
const PDFDocument = require('pdfkit');

const COLORS = {
  ink: '#1a1f2e',
  muted: '#5b6475',
  accent: '#0f6e56',
  pass: '#0f7a45',
  fail: '#b42318',
  warn: '#b54708',
  line: '#d8dee8',
  chip: '#e8f5f0',
  headerBg: '#0b3d2e'
};

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'UTC' }) + ' UTC';
  } catch {
    return String(iso);
  }
}

function drawHeader(doc, model) {
  doc.save();
  doc.rect(0, 0, doc.page.width, 72).fill(COLORS.headerBg);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('ForjaIA', 40, 22, { continued: false });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#c9e8dc')
    .text(model.projectName ? `${model.title} · ${model.projectName}` : model.title, 40, 44);
  doc.restore();
  doc.moveDown(3.2);
}

function sectionTitle(doc, title) {
  doc.moveDown(0.6);
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(13).text(title);
  doc
    .moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
    .strokeColor(COLORS.line)
    .stroke();
  doc.moveDown(0.5);
  doc.fillColor(COLORS.ink);
}

function kv(doc, label, value) {
  const x = doc.page.margins.left;
  const labelW = 140;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted).text(label, x, doc.y, { width: labelW, continued: false });
  const y = doc.y - 11;
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(String(value ?? '—'), x + labelW, y, {
      width: doc.page.width - doc.page.margins.right - x - labelW
    });
  doc.moveDown(0.15);
}

function ensureSpace(doc, needed = 80) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function para(doc, text, opts = {}) {
  doc
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts.size || 9)
    .fillColor(opts.color || COLORS.ink)
    .text(String(text || ''), {
      align: opts.align || 'left',
      lineGap: opts.lineGap ?? 1.5,
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right
    });
}

/**
 * @param {object} model
 * @param {string} outPath
 */
function buildReportPdf(model, outPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 48, left: 40, right: 40 },
      info: {
        Title: model.title,
        Author: 'ForjaIA Reporter',
        Subject: `Run ${model.runId}`,
        CreationDate: new Date()
      }
    });

    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
    doc.on('error', reject);

    drawHeader(doc, model);

    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text('Resumo executivo');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.ink).text(model.narrative, { align: 'justify', lineGap: 2 });

    let n = 1;
    const title = (t) => sectionTitle(doc, `${n++}. ${t}`);

    title('Identificação da execução');
    kv(doc, 'Projeto', model.projectName || '—');
    kv(doc, 'Run ID', model.runId);
    kv(doc, 'Status', String(model.status || '').toUpperCase());
    kv(doc, 'Modo', model.mode);
    kv(doc, 'Ambiente', model.environment || 'local');
    kv(doc, 'Projeto / origem', model.sourcePath || '—');
    kv(doc, 'Owner', model.owner ? `${model.owner.name} (${model.owner.role})` : '—');
    kv(doc, 'Prompt', model.prompt);
    kv(doc, 'Início', fmtDate(model.startedAt));
    kv(doc, 'Fim', fmtDate(model.finishedAt));
    kv(doc, 'Deploy', model.deployUrl || '—');
    kv(doc, 'Runtime deploy', model.deployRuntime || '—');
    kv(doc, 'Git branch', model.gitBranch || '—');
    kv(doc, 'Pull Request', model.prUrl || '—');
    kv(doc, 'Gerado em', fmtDate(model.generatedAt));
    kv(doc, 'Arquivo PDF', model.pdfPath || '—');
    if (model.error) kv(doc, 'Erro', model.error);

    title('Indicadores consolidados');
    const s = model.summary || {};
    const indicators = [
      `Testes QA: ${s.testsPassed}/${s.testsTotal} aprovados` + (s.testsFailed ? ` (${s.testsFailed} falha(s))` : ''),
      `Achados de segurança: ${s.securityIssues}`,
      `Arquivos no artefato: ${s.files}`,
      `Eventos do pipeline: ${s.events}`,
      `Pronto para produção: ${s.productionReady ? 'SIM' : 'NÃO'}`,
      `Humano in loco: ${s.humanPassed === true ? 'APROVADO' : s.humanPassed === false ? 'REPROVADO' : 'n/d'}`,
      `Checklist prod: ${s.prodChecksOk != null ? `${s.prodChecksOk}/${s.prodChecksTotal}` : 'n/d'}`
    ];
    for (const line of indicators) {
      para(doc, `• ${line}`, { size: 9.5 });
    }

    title('Resultados de QA (detalhe)');
    if (!model.tests?.length) {
      para(doc, 'Nenhum teste registrado.', { color: COLORS.muted });
    } else {
      model.tests.forEach((t, i) => {
        ensureSpace(doc, 48);
        const ok = !!t.passed;
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(ok ? COLORS.pass : COLORS.fail)
          .text(`${i + 1}. ${ok ? 'APROVADO' : 'REPROVADO'}`, { continued: true });
        doc.fillColor(COLORS.ink).font('Helvetica').text(`  —  ${t.name}`);
        if (t.error) para(doc, `Detalhe: ${t.error}`, { size: 8.5, color: COLORS.fail });
        if (t.details) para(doc, String(t.details), { size: 8.5, color: COLORS.muted });
        if (t.durationMs != null) para(doc, `Duração: ${t.durationMs} ms`, { size: 8, color: COLORS.muted });
        doc.moveDown(0.2);
      });
    }

    title('Segurança (detalhe)');
    if (!model.securityIssues?.length) {
      para(doc, 'Nenhuma vulnerabilidade reportada pelo agente de segurança.', { color: COLORS.pass });
    } else {
      for (const issue of model.securityIssues) {
        ensureSpace(doc, 80);
        para(doc, `${issue.id || ''} ${issue.title || issue.type || 'Achado'} [${issue.severity || 'n/d'}]`, {
          bold: true,
          size: 10
        });
        if (issue.file) para(doc, `Arquivo: ${issue.file}`, { size: 8.5, color: COLORS.muted });
        if (issue.description) para(doc, issue.description, { size: 9 });
        if (issue.remediation) para(doc, `Remediação: ${issue.remediation}`, { size: 8.5, color: COLORS.muted });
        doc.moveDown(0.3);
      }
    }

    if (model.diagnosis) {
      title('Diagnóstico (Depurador)');
      const d = model.diagnosis;
      kv(doc, 'Severidade', d.severity);
      para(doc, d.summary || '—', { size: 9 });
      if (d.notesForHealer) para(doc, `Notas ao Curador: ${d.notesForHealer}`, { size: 8.5, color: COLORS.muted });
      for (const rc of d.rootCauses || []) {
        ensureSpace(doc, 40);
        para(doc, `Causa ${rc.id}: ${rc.title} (confiança ${Math.round((rc.confidence || 0) * 100)}%)`, {
          bold: true,
          size: 9
        });
        if (rc.evidence) para(doc, `Evidência: ${rc.evidence}`, { size: 8.5, color: COLORS.muted });
        if (rc.affectedFiles?.length) para(doc, `Arquivos: ${rc.affectedFiles.join(', ')}`, { size: 8, color: COLORS.muted });
      }
      for (const fix of d.recommendedFixes || []) {
        para(doc, `Fix #${fix.priority}: ${fix.action}`, { size: 8.5 });
      }
    }

    title('Carga, caos e desempenho');
    const m = model.performanceMetrics;
    if (!m) {
      para(doc, 'Métricas de carga não disponíveis.', { color: COLORS.muted });
    } else {
      kv(doc, 'Alvo', m.target || '—');
      kv(doc, 'Modo de caos', m.chaosMode || '—');
      kv(doc, 'Requisições', m.totalRequests);
      kv(doc, 'Sucesso / falha', `${m.successfulRequests} / ${m.failedRequests}`);
      kv(doc, 'Taxa de sucesso', `${m.successRate}%`);
      kv(doc, 'RPS', m.rps);
      kv(doc, 'Latência média', `${m.avgLatency} ms`);
      if (m.p95Latency != null) kv(doc, 'Latência p95', `${m.p95Latency} ms`);
      if (m.p99Latency != null) kv(doc, 'Latência p99', `${m.p99Latency} ms`);
    }

    title('Teste humano in loco');
    const human = model.humanReport;
    if (!human) {
      para(doc, 'Sem sessão humana registrada.', { color: COLORS.muted });
    } else {
      kv(doc, 'Resultado', human.passed ? 'APROVADO' : 'REPROVADO');
      kv(doc, 'Persona', human.session?.persona || '—');
      kv(doc, 'Objetivo', human.session?.goal || '—');
      kv(doc, 'Fonte do plano', human.session?.planSource || '—');
      if (human.seniorReview?.summary) para(doc, human.seniorReview.summary, { size: 9 });
      if (human.notesForUserFix) para(doc, `Notas ao Corretor: ${human.notesForUserFix}`, { size: 8.5, color: COLORS.muted });
      const steps = human.session?.steps || [];
      if (steps.length) {
        para(doc, 'Passos executados:', { bold: true, size: 9 });
        steps.forEach((st, i) => {
          ensureSpace(doc, 36);
          const ok = st.ok !== false;
          para(
            doc,
            `${i + 1}. [${ok ? 'OK' : 'FAIL'}] ${st.asHuman || st.id || ''} — ${st.action || 'GET'} ${st.path || ''} (HTTP ${st.status ?? '—'}, ${st.ms ?? '—'}ms)`,
            { size: 8.5, color: ok ? COLORS.ink : COLORS.fail }
          );
          if (st.failure) para(doc, `   Falha: ${st.failure}`, { size: 8, color: COLORS.fail });
        });
      }
      if (human.issues?.length) {
        para(doc, 'Achados do humano:', { bold: true, size: 9 });
        for (const issue of human.issues) {
          para(doc, `• [${issue.severity}] ${issue.title}: ${issue.description || ''}`, { size: 8.5 });
        }
      }
    }

    title('Checklist de produção');
    const prod = model.productionReady;
    if (!prod) {
      para(doc, 'Checklist não executado.', { color: COLORS.muted });
    } else {
      kv(doc, 'Pronto', prod.ready ? 'SIM' : 'NÃO');
      kv(doc, 'Resumo', prod.summary || '—');
      for (const c of prod.checks || []) {
        ensureSpace(doc, 28);
        para(doc, `${c.ok ? '[OK]' : '[FAIL]'} ${c.title} (${c.severity}) — ${c.detail}`, {
          size: 8.5,
          color: c.ok ? COLORS.pass : COLORS.fail
        });
      }
      if (prod.artifactsWritten?.length) {
        para(doc, `Artefatos gravados: ${prod.artifactsWritten.map((a) => a.path).join(', ')}`, {
          size: 8,
          color: COLORS.muted
        });
      }
    }

    if (model.adrs?.length) {
      title('ADRs');
      for (const adr of model.adrs) {
        ensureSpace(doc, 70);
        para(doc, `${adr.id || ''} — ${adr.title || ''}`, { bold: true, size: 10 });
        para(doc, `Status: ${adr.status || '—'}`, { size: 9 });
        if (adr.context) para(doc, `Contexto: ${adr.context}`, { size: 8.5, color: COLORS.muted });
        if (adr.decision) para(doc, `Decisão: ${adr.decision}`, { size: 8.5 });
        if (adr.consequences) para(doc, `Consequências: ${adr.consequences}`, { size: 8.5, color: COLORS.muted });
        doc.moveDown(0.25);
      }
    }

    title('Inventário de arquivos');
    const files = model.files || [];
    if (!files.length) {
      para(doc, 'Nenhum arquivo listado.', { color: COLORS.muted });
    } else {
      files.forEach((f, i) => {
        ensureSpace(doc, 16);
        const pathStr = typeof f === 'string' ? f : f.path || f.name;
        const bytes = typeof f === 'object' && f.content != null ? String(f.content).length : null;
        para(doc, `${i + 1}. ${pathStr}${bytes != null ? ` (${bytes} chars)` : ''}`, { size: 8 });
      });
    }

    title('Tokens / LLM');
    const tok = model.tokenStats;
    if (!tok) {
      para(doc, 'Sem estatísticas de tokens.', { color: COLORS.muted });
    } else {
      kv(doc, 'Prompt (sessão)', tok.prompt);
      kv(doc, 'Completion (sessão)', tok.completion);
      kv(doc, 'Total (sessão)', tok.total);
      kv(doc, 'Chamadas', tok.calls);
      kv(doc, 'Pico prompt', tok.peakPrompt);
      kv(doc, 'Pico completion', tok.peakCompletion);
      kv(doc, 'Pico total', tok.peakTotal);
      if (tok.last) {
        kv(doc, 'Última chamada', `${tok.last.total || 0} tok · ${tok.last.provider || '—'} · ${tok.last.model || '—'}`);
        kv(doc, 'Última em', fmtDate(tok.last.at));
      }
    }

    title('Atividade por agente (amostra + contagens)');
    const agents = Object.entries(model.agentBreakdown || {});
    if (!agents.length) {
      para(doc, 'Sem eventos.', { color: COLORS.muted });
    } else {
      for (const [name, stats] of agents) {
        ensureSpace(doc, 60);
        para(
          doc,
          `${name} — ok:${stats.success || 0} info:${stats.info || 0} warn:${stats.warning || 0} err:${stats.error || 0}`,
          { bold: true, size: 10 }
        );
        for (const msg of stats.messages || []) {
          para(doc, `  [${msg.type}] ${String(msg.message || '')}`, { size: 7.5, color: COLORS.muted });
        }
        doc.moveDown(0.2);
      }
    }

    title('Linha do tempo completa');
    const timeline = model.timeline || [];
    if (!timeline.length) {
      para(doc, 'Sem eventos.', { color: COLORS.muted });
    } else {
      timeline.forEach((e, idx) => {
        ensureSpace(doc, 32);
        para(doc, `#${idx + 1} ${fmtDate(e.at)} · ${e.agent} · ${e.type}`, { size: 7.5, color: COLORS.muted });
        para(doc, String(e.message || ''), { size: 8.5 });
        doc.moveDown(0.1);
      });
    }

    title('Como baixar / onde está o arquivo');
    para(
      doc,
      [
        `1) UI ForjaIA: painel direito (QA) → "Baixar relatório PDF", ou aba Código / Histórico → link "PDF" / "Relatório PDF".`,
        `2) API: GET /api/runs/${model.runId}/report.pdf?token=<FORJA_API_TOKEN>`,
        `3) Disco: ${model.pdfPath || '(gerado em FORJA_WORKSPACE_ROOT/_reports/)'}`
      ].join('\n'),
      { size: 9 }
    );

    doc.moveDown(1);
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        'Documento detalhado gerado pelo agente Reporter do ForjaIA — registro de QA, segurança, DevOps, humano in loco, checklist de produção e linha do tempo.',
        { align: 'center' }
      );

    doc.end();
  });
}

module.exports = { buildReportPdf };
