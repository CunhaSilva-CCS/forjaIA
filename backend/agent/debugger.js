const config = require('../lib/config');
const { generateJson } = require('../lib/llm');
const { composeSystemPrompt, announceThinking } = require('../lib/seniorEngineer');

/**
 * Depurador Sênior — diagnostica falhas de QA/segurança antes do Curador aplicar patches.
 * Não reescreve o código; produz hipóteses de causa raiz e plano de verificação.
 */
module.exports = {
  execute: async (files, testReport, securityReport, runConfig, orchestrator) => {
    orchestrator.throwIfAborted();
    announceThinking(orchestrator, 'debugger');

    const failedTests = (testReport?.tests || []).filter((t) => !t.passed);
    const issues = securityReport?.issues || [];

    const system = composeSystemPrompt(
      'debugger',
      `DIAGNOSTIQUE — não corrija o código.
Correlacione falhas de testes e achados de segurança com os arquivos.
Seja preciso, evidência-first, e entregue instruções acionáveis para o Curador.
Retorne APENAS JSON estrito:
{
  "summary": "resumo em 1-2 frases",
  "severity": "baixa|media|alta|critica",
  "rootCauses": [
    { "id": "RC-1", "title": "...", "confidence": 0.0, "evidence": "...", "affectedFiles": ["path"] }
  ],
  "hypotheses": [
    { "id": "H-1", "statement": "...", "howToVerify": "passo concreto de verificação" }
  ],
  "reproductionSteps": ["passo 1", "passo 2"],
  "recommendedFixes": [
    { "priority": 1, "action": "o que o Curador deve corrigir", "files": ["path"] }
  ],
  "notesForHealer": "instruções objetivas para o agente Curador"
}`,
      runConfig
    );

    const fileIndex = (files || []).map((f) => ({
      path: f.path,
      bytes: Buffer.byteLength(f.content || '', 'utf8'),
      preview: String(f.content || '').slice(0, 4000)
    }));

    const user = `
Contexto do projeto (modo=${runConfig.mode || 'forge'}):
Arquivos (${fileIndex.length}):
${JSON.stringify(fileIndex)}

Testes falhos:
${JSON.stringify(failedTests)}

Relatório QA completo:
${JSON.stringify({
  passed: testReport?.passed,
  tests: testReport?.tests || []
})}

Achados de segurança:
${JSON.stringify(issues)}
`;

    try {
      const result = await generateJson({
        system,
        user,
        runConfig,
        signal: orchestrator.getSignal()
      });
      if (result.tokens) {
        orchestrator.recordTokens(result.tokens, {
          provider: result.provider,
          model: result.model
        });
      }

      const diagnosis = normalizeDiagnosis(result.data, failedTests, issues);
      orchestrator.log(
        'debugger',
        `Diagnóstico pronto (${diagnosis.rootCauses.length} causa(s), severidade ${diagnosis.severity}) via ${result.provider}.`,
        'success'
      );
      return diagnosis;
    } catch (err) {
      if (!config.allowMocks) {
        throw new Error(`Falha no LLM do Depurador (mocks desligados): ${err.message}`);
      }

      orchestrator.log(
        'debugger',
        `LLM indisponível (${err.message}); gerando diagnóstico heurístico.`,
        'warning'
      );
      return heuristicDiagnosis(failedTests, issues, files);
    }
  }
};

function normalizeDiagnosis(raw, failedTests, issues) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    summary: data.summary || 'Diagnóstico gerado pelo Depurador Sênior.',
    severity: data.severity || (issues.length || failedTests.length ? 'alta' : 'baixa'),
    rootCauses: Array.isArray(data.rootCauses) ? data.rootCauses : [],
    hypotheses: Array.isArray(data.hypotheses) ? data.hypotheses : [],
    reproductionSteps: Array.isArray(data.reproductionSteps) ? data.reproductionSteps : [],
    recommendedFixes: Array.isArray(data.recommendedFixes) ? data.recommendedFixes : [],
    notesForHealer: data.notesForHealer || ''
  };
}

function heuristicDiagnosis(failedTests, issues, files) {
  const rootCauses = [];
  const hypotheses = [];
  const recommendedFixes = [];

  for (const t of failedTests) {
    rootCauses.push({
      id: `QA-${rootCauses.length + 1}`,
      title: `Teste falhou: ${t.name}`,
      confidence: 0.55,
      evidence: t.error || 'sem detalhe de erro',
      affectedFiles: guessFiles(files, t.name, t.error)
    });
    hypotheses.push({
      id: `H-QA-${hypotheses.length + 1}`,
      statement: `A rota ou contrato envolvido em "${t.name}" divergem do esperado pelo QA.`,
      howToVerify: `Reexecutar o caso "${t.name}" isolado e inspecionar status/body da resposta.`
    });
    recommendedFixes.push({
      priority: recommendedFixes.length + 1,
      action: `Corrigir a falha do teste "${t.name}": ${t.error || 'ajustar comportamento'}`,
      files: guessFiles(files, t.name, t.error)
    });
  }

  for (const issue of issues) {
    rootCauses.push({
      id: `SEC-${rootCauses.length + 1}`,
      title: issue.title || issue.type || 'Achado de segurança',
      confidence: 0.7,
      evidence: issue.description || '',
      affectedFiles: issue.file ? [issue.file] : []
    });
    recommendedFixes.push({
      priority: recommendedFixes.length + 1,
      action: issue.remediation || `Remediar: ${issue.title}`,
      files: issue.file ? [issue.file] : []
    });
  }

  if (!rootCauses.length) {
    rootCauses.push({
      id: 'RC-0',
      title: 'Nenhuma falha explícita listada',
      confidence: 0.3,
      evidence: 'Relatórios vazios',
      affectedFiles: []
    });
  }

  return {
    summary: `${failedTests.length} teste(s) falho(s) e ${issues.length} achado(s) de segurança para investigar.`,
    severity: issues.some((i) => /high|crit/i.test(i.severity || '')) ? 'critica' : 'alta',
    rootCauses,
    hypotheses,
    reproductionSteps: failedTests.map((t) => `Reproduzir: ${t.name}`),
    recommendedFixes,
    notesForHealer:
      'Aplicar correções pontuais nas causas listadas; não refatore além do necessário; preserve APIs existentes.'
  };
}

function guessFiles(files, name, error) {
  const blob = `${name || ''} ${error || ''}`.toLowerCase();
  const hits = (files || [])
    .filter((f) => {
      const p = String(f.path || '').toLowerCase();
      return (
        (blob.includes('health') && p.includes('health')) ||
        (blob.includes('auth') && p.includes('auth')) ||
        (blob.includes('route') && p.includes('route')) ||
        (blob.includes('server') && p.includes('server')) ||
        blob.includes(p.split('/').pop().replace(/\.\w+$/, ''))
      );
    })
    .map((f) => f.path);
  return hits.slice(0, 5);
}
