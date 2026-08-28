const fs = require('fs');
const path = require('path');

// Um analisador estático (SAST) leve baseado em padrões de expressão regular no código fonte gerado
function runStaticAnalysis(files) {
  const issues = [];
  
  for (const file of files) {
    if (!file || typeof file.content !== 'string') continue;
    const code = file.content;
    const filePath = file.path || 'unknown.js';

    // 1. Procurar por SQL Injection (concatenação de strings em SQL)
    if (code.includes('db.query') || code.includes('sqlite') || code.includes('SELECT') || code.includes('INSERT')) {
      const sqlConcatRegex = /(SELECT|INSERT|UPDATE|DELETE).*\+.*(req\.|body\.|params\.)/i;
      const templateLiteralConcat = /[\`].*\$\{.*(req\.|body\.|params\.).*\}.*[\`]/i;
      
      if (sqlConcatRegex.test(code) || templateLiteralConcat.test(code)) {
        issues.push({
          id: 'SEC-SQLI',
          title: 'Vulnerabilidade de Injeção SQL (Causa Raiz: Concatenação Dinâmica)',
          severity: 'HIGH',
          file: filePath,
          description: 'O código utiliza concatenação direta de dados vindos do usuário (req.body/req.params) em instruções SQL. Isso permite que um atacante manipule a query executada.',
          remediation: 'Utilize consultas parametrizadas (Prepared Statements) ou ORMs que façam escaping automático.'
        });
      }
    }

    // 2. Procurar por segredos expostos (Hardcoded secrets)
    const secretRegex = /(const|let|var)\s+(JWT_SECRET|SECRET|API_KEY|PASSWORD)\s*=\s*['"\`][a-zA-Z0-9_\-]{4,30}['"\`]/i;
    if (secretRegex.test(code) && !code.includes('process.env')) {
      // Ignorar chaves que tenham fallback process.env
      if (!code.includes('process.env.JWT_SECRET')) {
        issues.push({
          id: 'SEC-SECRET',
          title: 'Exposição de Credenciais / Segredos em Texto Claro (Hardcoded)',
          severity: 'HIGH',
          file: filePath,
          description: 'Identificada chave secreta definida de forma estática no código fonte. Se este arquivo for exposto no repositório, o token pode ser facilmente forjado ou a conexão com APIs externas violada.',
          remediation: 'Mova segredos para variáveis de ambiente (.env) e use process.env para carregá-los.'
        });
      }
    }

    // 3. Falta de sanitização contra XSS (uso de innerHTML)
    if (code.includes('innerHTML') && (code.includes('req.body') || code.includes('params'))) {
      issues.push({
        id: 'SEC-XSS',
        title: 'Cross-Site Scripting (DOM-based XSS)',
        severity: 'MEDIUM',
        file: filePath,
        description: 'Uso de innerHTML atribuindo strings recebidas diretamente do usuário. Pode permitir a execução de scripts maliciosos no navegador.',
        remediation: 'Utilize textContent, innerText ou sanitizadores HTML antes de inserir conteúdo dinâmico.'
      });
    }

    // 4. Injeção de Comando (Uso de eval ou child_process.exec com variáveis de usuário)
    if (code.includes('eval(') || (code.includes('exec(') && code.includes('child_process'))) {
      issues.push({
        id: 'SEC-RCE',
        title: 'Execução Remota de Código (RCE)',
        severity: 'CRITICAL',
        file: filePath,
        description: 'Uso perigoso de funções do sistema (eval/exec) com parâmetros de entrada do usuário.',
        remediation: 'Evite o uso de eval. Use funções utilitárias nativas e faça validações por Whitelist para parâmetros passados ao sistema operacional.'
      });
    }
  }

  return issues;
}

// Execução de testes de intrusão ativos (DAST) contra a API rodando na sandbox
async function runActivePentesting(baseUrl, orchestrator) {
  const issues = [];

  try {
    orchestrator.log('security', 'Hacker Agent: sondando endpoints comuns...', 'warning');

    // Auth SQLi (se existir)
    const sqliPayload = { email: "admin' OR '1'='1", password: 'arbitrary_pwd' };
    let res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sqliPayload),
      signal: AbortSignal.timeout(4000)
    }).catch(() => null);

    if (res && res.status === 200) {
      const data = await res.json().catch(() => ({}));
      if (data.success && data.token) {
        issues.push({
          id: 'ACTIVE-SQLI',
          title: 'Vulnerabilidade SQL Injection Confirmada Dinamicamente',
          severity: 'HIGH',
          description: "Login aceitou payload SQLi admin' OR '1'='1",
          remediation: 'Parametrizar a query SQL.'
        });
      }
    }

    // Tasks XSS (se existir)
    res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: "<script>alert('hacked')</script>", description: 'xss' }),
      signal: AbortSignal.timeout(4000)
    }).catch(() => null);

    if (res && res.status === 201) {
      const data = await res.json().catch(() => ({}));
      if (data.success && data.task && String(data.task.title).includes('<script>')) {
        issues.push({
          id: 'ACTIVE-XSS',
          title: 'Armazenamento de Payload XSS Ativo',
          severity: 'MEDIUM',
          description: 'API armazenou tag <script> sem sanitização.',
          remediation: 'Escapar/sanitizar inputs de texto.'
        });
      }
    }

    // RAG: tentar injeção via ingest/query
    orchestrator.log('security', 'Hacker Agent: testando ingestão RAG com payload suspeito...', 'warning');
    res = await fetch(`${baseUrl}/api/ingest/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'evil',
        text: "'; DROP TABLE documents; -- <script>alert(1)</script>"
      }),
      signal: AbortSignal.timeout(10000)
    }).catch(() => null);

    if (res && res.ok) {
      const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
      if (!health || !health.ok) {
        issues.push({
          id: 'ACTIVE-RAG-INJECT',
          title: 'Possível quebra pós-ingestão maliciosa',
          severity: 'HIGH',
          description: 'Após ingestão de payload hostil, /api/health deixou de responder.',
          remediation: 'Validar/sanitizar conteúdo ingerido e isolar persistência.'
        });
      }
    }
  } catch (err) {
    orchestrator.log('security', `Aviso durante pentest ativo: ${err.message}`, 'warning');
  }

  return issues;
}

module.exports = {
  execute: async (files, config, orchestrator) => {
    const { announceThinking, thinkAsSenior } = require('../lib/seniorEngineer');
    announceThinking(orchestrator, 'security');

    // 1. Rodar análise estática de código (SAST) + scanner determinístico de segredos (ADR-011)
    orchestrator.log('security', 'Iniciando análise de código estática (SAST)...', 'info');
    const { scanForHardcodedSecrets } = require('../lib/secretScan');
    const staticIssues = [...runStaticAnalysis(files), ...scanForHardcodedSecrets(files)];

    // 2. Inicializar sandbox para rodar testes dinâmicos (DAST)
    const sandboxRunner = require('../sandbox/runner');
    let dynamicIssues = [];
    
    let dastFailed = false;
    let dastError = null;
    try {
      const sandboxInfo = await sandboxRunner.start(files, orchestrator);
      dynamicIssues = await runActivePentesting(sandboxInfo.baseUrl, orchestrator);
      await sandboxRunner.stop(orchestrator);
    } catch (e) {
      dastFailed = true;
      dastError = e.message || String(e);
      orchestrator.log('security', `Pentest dinâmico indisponível: ${dastError}`, 'warning');
      try {
        await sandboxRunner.stop(orchestrator);
      } catch {
        // ignore cleanup errors
      }
    }

    const allIssues = [...staticIssues, ...dynamicIssues];
    if (dastFailed) {
      allIssues.push({
        id: 'SEC-DAST-UNAVAILABLE',
        title: 'Análise dinâmica (DAST) não executada',
        severity: 'HIGH',
        description: `Sandbox/pentest falhou: ${dastError}`,
        remediation: 'Garantir Docker/sandbox local e reexecutar Segurança antes de aprovar deploy.'
      });
    }

    const senior = await thinkAsSenior({
      role: 'security',
      taskContract: `Atue como AppSec sênior. Revise achados SAST/DAST e o código.
Pode adicionar novos achados reais (sem inventar CVEs fictícios) e melhorar remediações.
Retorne APENAS JSON:
{
  "verdict": "seguro|ressalvas|inseguro",
  "summary": "1-3 frases",
  "extraIssues": [{"id":"SEC-...","title":"...","severity":"LOW|MEDIUM|HIGH|CRITICAL","file":"path?","description":"...","remediation":"..."}],
  "prioritizedRemediation": ["ação 1", "ação 2"],
  "notesForDebugger": "foco para o Depurador se houver falhas"
}`,
      userPayload: {
        issues: allIssues,
        files: (files || []).map((f) => ({
          path: f.path,
          preview: String(f.content || '').slice(0, 3500)
        }))
      },
      runConfig: config,
      orchestrator
    });

    if (senior?.extraIssues?.length) {
      for (const issue of senior.extraIssues) {
        if (!issue?.title) continue;
        allIssues.push({
          id: issue.id || `SEC-LLM-${allIssues.length + 1}`,
          title: issue.title,
          severity: issue.severity || 'MEDIUM',
          file: issue.file,
          description: issue.description || '',
          remediation: issue.remediation || ''
        });
      }
    }
    if (senior?.summary) {
      orchestrator.log(
        'security',
        `Sênior AppSec: ${senior.summary}`,
        senior.verdict === 'seguro' ? 'success' : 'warning'
      );
    }
    
    if (allIssues.length === 0) {
      orchestrator.log('security', 'Nenhuma vulnerabilidade crítica ou média foi encontrada pelo hacker ético.', 'success');
      return {
        passed: true,
        issues: [],
        seniorReview: senior || null
      };
    } else {
      orchestrator.log('security', `ALERTA: Hacker detectou ${allIssues.length} vulnerabilidade(s) no software gerado!`, 'error');
      allIssues.forEach(iss => {
        orchestrator.log('security', `[${iss.severity}] ${iss.title} - Remediar: ${iss.remediation}`, 'warning');
      });
      return {
        passed: false,
        issues: allIssues,
        seniorReview: senior || null
      };
    }
  }
};
