const path = require('path');
const fs = require('fs');

async function runAuthTests(baseUrl, orchestrator) {
  const tests = [
    { name: 'Cadastro de Usuário - Sucesso', passed: false, error: null },
    { name: 'Cadastro de Usuário - Falha (Dados incompletos)', passed: false, error: null },
    { name: 'Login de Usuário - Sucesso', passed: false, error: null },
    { name: 'Login de Usuário - Falha (Senha incorreta)', passed: false, error: null },
    { name: 'Acesso a Rota Protegida com Token Válido', passed: false, error: null },
    { name: 'Acesso a Rota Protegida Sem Token (Bloqueado)', passed: false, error: null }
  ];

  const testUser = {
    name: 'QA Engineer',
    email: `qa.${Date.now()}@test.com`,
    password: 'Password123!'
  };

  const isOkStatus = (data) =>
    data?.success === true || data?.status === 'success' || data?.status === 'ok';
  const isFailStatus = (data) =>
    data?.success === false ||
    data?.status === 'error' ||
    data?.status === 'fail' ||
    Boolean(data?.error || data?.message);
  const pickToken = (data) =>
    data?.token || data?.accessToken || data?.data?.token || data?.data?.accessToken || null;
  const pickUser = (data) => data?.user || data?.data?.user || null;

  let token = '';

  try {
    // Teste 1: Cadastro Sucesso
    orchestrator.log('qa', 'Executando teste: Cadastro de Usuário - Sucesso...', 'info');
    let res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });
    let data = await res.json().catch(() => ({}));
    if ((res.status === 201 || res.status === 200) && (isOkStatus(data) || pickToken(data) || pickUser(data))) {
      tests[0].passed = true;
      token = pickToken(data) || token;
    } else {
      tests[0].error = `Código HTTP: ${res.status}, Resposta: ${JSON.stringify(data)}`;
    }

    // Teste 2: Cadastro Falha
    orchestrator.log('qa', 'Executando teste: Cadastro de Usuário - Falha...', 'info');
    res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'incomplete@test.com' })
    });
    data = await res.json().catch(() => ({}));
    if (res.status >= 400 && res.status < 500) {
      tests[1].passed = true;
    } else {
      tests[1].error = `Esperado status 4xx. Recebido: ${res.status}. Resposta: ${JSON.stringify(data)}`;
    }

    // Teste 3: Login Sucesso
    orchestrator.log('qa', 'Executando teste: Login de Usuário - Sucesso...', 'info');
    res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: testUser.password })
    });
    data = await res.json().catch(() => ({}));
    const loginToken = pickToken(data);
    if (res.status === 200 && loginToken) {
      tests[2].passed = true;
      token = loginToken;
    } else {
      tests[2].error = `Esperado status 200 com Token JWT. Recebido: ${res.status}. Resposta: ${JSON.stringify(data)}`;
    }

    // Teste 4: Login Falha
    orchestrator.log('qa', 'Executando teste: Login de Usuário - Falha (Senha incorreta)...', 'info');
    res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: 'wrongpassword' })
    });
    data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403 || (res.status >= 400 && isFailStatus(data))) {
      tests[3].passed = true;
    } else {
      tests[3].error = `Esperado status 401. Recebido: ${res.status}. Resposta: ${JSON.stringify(data)}`;
    }

    // Teste 5: Rota Protegida Sucesso
    if (token) {
      orchestrator.log('qa', 'Executando teste: Rota Protegida com Token Válido...', 'info');
      res = await fetch(`${baseUrl}/api/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      data = await res.json().catch(() => ({}));
      if (res.status === 200 && (pickUser(data) || isOkStatus(data))) {
        tests[4].passed = true;
      } else {
        tests[4].error = `Esperado status 200 com payload usuário. Recebido: ${res.status}. Resposta: ${JSON.stringify(data)}`;
      }
    } else {
      tests[4].error = 'Ignorado devido a falha no teste de login.';
    }

    // Teste 6: Rota Protegida Sem Token
    orchestrator.log('qa', 'Executando teste: Rota Protegida Sem Token (Bloqueado)...', 'info');
    res = await fetch(`${baseUrl}/api/auth/me`, {
      method: 'GET'
    });
    data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      tests[5].passed = true;
    } else {
      tests[5].error = `Esperado status 401. Recebido: ${res.status}. Resposta: ${JSON.stringify(data)}`;
    }
  } catch (err) {
    orchestrator.log('qa', `Falha de rede ao conectar à API na Sandbox: ${err.message}`, 'error');
    tests.forEach((t) => {
      if (!t.passed && !t.error) t.error = err.message;
    });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    passed: passedCount === tests.length,
    tests
  };
}

/**
 * Achado real (dogfooding ao vivo, ver ADR-034): esta suíte foi escrita pra validar o formato
 * EXATO dos MOCK_CODES de agent/coder.js (`{success:true, tasks:[...]}`, `{success:true,
 * task:{id,...}}`) — o fallback offline usado só quando `config.allowMocks` está ligado. Mas ela
 * roda incondicionalmente, inclusive contra código real gerado por LLM, que só é instruído sobre
 * o contrato ABSTRATO da constituição (`{success, data|error}`), nunca os nomes de campo
 * específicos `tasks`/`task`. Resultado observado: um app funcionalmente correto (200 com lista
 * vazia, 201 com recurso criado, 400 exatamente onde esperado) reprovava 100% dos testes porque a
 * asserção exigia literalmente a chave `tasks`/`task`, não qualquer JSON razoável.
 *
 * Mesmo padrão de tolerância que runAuthTests já usa (pickToken/pickUser aceitam vários formatos)
 * — aplicado aqui pela primeira vez. Continua validando o que importa de verdade (status HTTP
 * correto, o recurso criado tem id, a atualização realmente aplicou), só não trava mais em UMA
 * convenção de nome de campo entre várias igualmente razoáveis.
 */
async function runCrudTests(baseUrl, orchestrator) {
  const tests = [
    { name: 'Listar Tarefas (GET /api/tasks) - Sucesso', passed: false, error: null },
    { name: 'Criar Tarefa (POST /api/tasks) - Sucesso', passed: false, error: null },
    { name: 'Criar Tarefa - Falha (Sem título)', passed: false, error: null },
    { name: 'Atualizar Tarefa (PUT /api/tasks/:id) - Sucesso', passed: false, error: null },
    { name: 'Deletar Tarefa (DELETE /api/tasks/:id) - Sucesso', passed: false, error: null }
  ];

  // Lista pode vir como array na raiz, ou dentro de qualquer chave de envelope razoável.
  const pickList = (data) => {
    if (Array.isArray(data)) return data;
    for (const key of ['tasks', 'data', 'items', 'results', 'todos']) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return null;
  };
  // Recurso recém-criado pode vir na raiz, ou dentro de task/data/item.
  const pickCreated = (data) => data?.id ? data : (data?.task || data?.data || data?.item || null);
  const pickCompleted = (data) =>
    data?.completed ?? data?.task?.completed ?? data?.data?.completed ?? data?.item?.completed;

  let createdTaskId = null;

  try {
    // Teste 1: GET /api/tasks
    orchestrator.log('qa', 'Executando teste: Listar Tarefas...', 'info');
    let res = await fetch(`${baseUrl}/api/tasks`);
    let data = await res.json().catch(() => null);
    const list = pickList(data);
    if (res.status === 200 && list !== null) {
      tests[0].passed = true;
    } else {
      tests[0].error = `Erro ao recuperar tarefas. Status: ${res.status}, Resposta: ${JSON.stringify(data)}`;
    }

    // Teste 2: POST /api/tasks
    orchestrator.log('qa', 'Executando teste: Criar Tarefa...', 'info');
    res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Nova Tarefa de QA', description: 'Criada nos testes automatizados' })
    });
    data = await res.json().catch(() => null);
    const created = pickCreated(data);
    if ((res.status === 201 || res.status === 200) && created?.id) {
      tests[1].passed = true;
      createdTaskId = created.id;
    } else {
      tests[1].error = `Erro ao criar tarefa. Status: ${res.status}, Resposta: ${JSON.stringify(data)}`;
    }

    // Teste 3: POST /api/tasks (Sem título) — o status 4xx já é o sinal que importa; não exige
    // mais nenhum formato específico de corpo de erro.
    orchestrator.log('qa', 'Executando teste: Criar Tarefa sem Título (Falha esperada)...', 'info');
    res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Sem título' })
    });
    data = await res.json().catch(() => null);
    if (res.status >= 400 && res.status < 500) {
      tests[2].passed = true;
    } else {
      tests[2].error = `Esperado status 4xx. Status obtido: ${res.status}, Resposta: ${JSON.stringify(data)}`;
    }

    // Teste 4: PUT /api/tasks/:id
    if (createdTaskId) {
      orchestrator.log('qa', 'Executando teste: Atualizar Tarefa...', 'info');
      res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Tarefa Atualizada pelo QA', completed: true })
      });
      data = await res.json().catch(() => null);
      if (res.status === 200 && pickCompleted(data) === true) {
        tests[3].passed = true;
      } else {
        tests[3].error = `Erro ao atualizar. Status: ${res.status}, Resposta: ${JSON.stringify(data)}`;
      }
    } else {
      tests[3].error = 'Ignorado devido a falha na criação da tarefa.';
    }

    // Teste 5: DELETE /api/tasks/:id — 204 No Content é uma resposta válida e comum pra DELETE
    // (sem corpo pra fazer .json()); a versão anterior desta suíte quebraria nesse caso.
    if (createdTaskId) {
      orchestrator.log('qa', 'Executando teste: Deletar Tarefa...', 'info');
      res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}`, {
        method: 'DELETE'
      });
      if (res.status === 204 || res.status === 200) {
        tests[4].passed = true;
      } else {
        data = await res.json().catch(() => null);
        tests[4].error = `Erro ao deletar. Status: ${res.status}, Resposta: ${JSON.stringify(data)}`;
      }
    } else {
      tests[4].error = 'Ignorado devido a falha na criação da tarefa.';
    }

  } catch (err) {
    orchestrator.log('qa', `Falha de rede ao conectar à API na Sandbox: ${err.message}`, 'error');
    tests.forEach(t => { if (!t.passed && !t.error) t.error = err.message; });
  }

  const passedCount = tests.filter(t => t.passed).length;
  return {
    passed: passedCount === tests.length,
    tests
  };
}

async function runRagTests(baseUrl, orchestrator) {
  const tests = [
    { name: 'Health check RAG', passed: false, error: null },
    { name: 'Ingestão de texto', passed: false, error: null },
    { name: 'Query com retrieval', passed: false, error: null },
    { name: 'Query inválida (400)', passed: false, error: null }
  ];

  // Mesmo raciocínio de runCrudTests (ver ADR-034): não exige mais a chave exata `matches`/
  // `success` — qualquer array de resultado razoável ou sinal de saúde conta.
  const pickMatches = (data) => {
    if (Array.isArray(data)) return data;
    for (const key of ['matches', 'results', 'data']) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return null;
  };

  try {
    orchestrator.log('qa', 'Executando teste: Health check RAG...', 'info');
    let res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    let data = await res.json().catch(() => null);
    if (res.ok && (data?.ok === true || data?.status === 'ok' || data?.status === 'healthy' || data?.success === true)) {
      tests[0].passed = true;
    } else tests[0].error = `HTTP ${res.status}: ${JSON.stringify(data)}`;

    orchestrator.log('qa', 'Executando teste: Ingestão de texto...', 'info');
    res = await fetch(`${baseUrl}/api/ingest/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Doc QA',
        text: 'O ForjaIA valida projetos existentes com QA, Segurança, Curador e DevOps.'
      }),
      signal: AbortSignal.timeout(30000)
    });
    data = await res.json().catch(() => null);
    if (res.status === 201 || res.status === 200) tests[1].passed = true;
    else tests[1].error = `HTTP ${res.status}: ${JSON.stringify(data)}`;

    orchestrator.log('qa', 'Executando teste: Query com retrieval...', 'info');
    res = await fetch(`${baseUrl}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'O que o ForjaIA valida?', generate: false }),
      signal: AbortSignal.timeout(30000)
    });
    data = await res.json().catch(() => null);
    const matches = pickMatches(data);
    if (res.ok && matches !== null && matches.length > 0) {
      tests[2].passed = true;
    } else tests[2].error = `HTTP ${res.status}: ${JSON.stringify(data)}`;

    orchestrator.log('qa', 'Executando teste: Query inválida...', 'info');
    res = await fetch(`${baseUrl}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '' }),
      signal: AbortSignal.timeout(5000)
    });
    if (res.status === 400) tests[3].passed = true;
    else {
      data = await res.json().catch(() => ({}));
      tests[3].error = `Esperado 400. Recebido ${res.status}: ${JSON.stringify(data)}`;
    }
  } catch (err) {
    orchestrator.log('qa', `Falha de rede na sandbox RAG: ${err.message}`, 'error');
    tests.forEach((t) => {
      if (!t.passed && !t.error) t.error = err.message;
    });
  }

  return {
    passed: tests.every((t) => t.passed),
    tests
  };
}

const TEST_PLAN_CONTRACT = `Você é um engenheiro de QA sênior. Com base nos arquivos de código reais abaixo — que já foram
escritos e serão executados contra um servidor HTTP real numa sandbox — gere um plano de teste de
integração executável cobrindo os endpoints REALMENTE expostos por esse código. Não invente rota
que não exista no código.

Retorne APENAS JSON estrito:
{
  "cases": [
    {
      "name": "nome curto e descritivo do teste",
      "method": "GET|POST|PUT|PATCH|DELETE",
      "path": "/api/algo ou /api/algo/{variavelCapturada}",
      "body": {} ou null,
      "auth": true ou false,
      "expectedStatus": "2xx" ou "4xx" ou "200" ou "201" ou "204" ou "401" (classe ou código exato),
      "expect": "none" | "list" | "object-id" | "token" | "field:<nomeDoCampo>=<valorEsperado>",
      "captureAs": "nomeDaVariavel" ou null
    }
  ]
}

Regras:
- Use {nomeDaVariavel} no "path" pra reaproveitar um valor capturado num caso anterior via
  "captureAs" (ex.: capture o id criado como "createdId" com expect "object-id", depois use
  "/api/tasks/{createdId}" num caso posterior). Um caso "auth":true reusa automaticamente o token
  capturado por qualquer caso com expect "token", não precisa nomear a variável.
- "expect":"list" e "expect":"object-id" são deliberadamente tolerantes a formato de envelope —
  NÃO exija um nome de campo específico (ex.: não assuma que a lista vem sob a chave "tasks"; pode
  vir na raiz da resposta ou em qualquer envelope razoável). Só "field:<nome>=<valor>" e o caminho
  do JSON dentro do "body" da requisição precisam ser específicos.
- Cubra pelo menos um caminho de sucesso e um de falha de validação por recurso principal; se
  houver autenticação, inclua registro/login e acesso autorizado/não autorizado a uma rota
  protegida.
- Gere entre 3 e 12 casos. Priorize cobrir o que existe de verdade no código a testar exaustivamente
  um único endpoint.`;

async function generateTestPlan(files, config, orchestrator) {
  const { generateJson } = require('../lib/llm');
  const { composeSystemPrompt } = require('../lib/seniorEngineer');
  const codeBlob = (files || [])
    .filter((f) => !/\.(png|jpe?g|gif|svg|ico|lock|woff2?|ttf)$/i.test(f.path || ''))
    .map((f) => `--- ${f.path} ---\n${f.content || ''}`)
    .join('\n\n');

  const result = await generateJson({
    system: composeSystemPrompt('qa', TEST_PLAN_CONTRACT, config),
    user: `Arquivos gerados para este projeto:\n\n${codeBlob}`,
    runConfig: config,
    signal: orchestrator.getSignal()
  });
  if (result.tokens) {
    orchestrator.recordTokens(result.tokens, { provider: result.provider, model: result.model });
  }
  return result.data;
}

function detectSuite(files) {
  const blob = files.map((f) => `${f.path}\n${f.content || ''}`).join('\n').toLowerCase();
  if (blob.includes('/api/ingest') || blob.includes('queryrag') || blob.includes('rag-profissional') || blob.includes('similaritysearch')) {
    return 'rag';
  }
  if (blob.includes('/api/auth') || blob.includes('authcontroller') || blob.includes('jwt')) {
    return 'auth';
  }
  return 'crud';
}

/** Projeto mobile Expo/RN: sem HTTP pra testar, roda a suíte nativa do próprio projeto (ver
 * ADR-014). Só funciona quando o projeto já existe em disco com node_modules instalado (modo
 * "validar projeto existente") — no modo "forge" a partir do zero não há onde rodar o Jest ainda. */
async function runMobileSuite(files, runConfig, orchestrator) {
  const { detectProjectType } = require('../lib/projectType');
  if (detectProjectType(files) !== 'mobile-expo') return null;

  const isValidate = runConfig.mode === 'validate';
  const relativeTarget = runConfig.targetPath || (isValidate ? runConfig.sourcePath : null);
  if (!relativeTarget) {
    orchestrator.log(
      'qa',
      'Projeto mobile detectado, mas sem caminho em disco (modo forge do zero) — QA nativo exige o projeto já instalado. Pulando QA.',
      'warning'
    );
    return { passed: true, tests: [] };
  }

  const { resolveWithinWorkspace } = require('../lib/paths');
  const { runNativeTestSuite } = require('../lib/mobileTest');
  const projectDir = resolveWithinWorkspace(relativeTarget);
  return runNativeTestSuite(projectDir, orchestrator);
}

function logPreflightQaParity(orchestrator, qaReport) {
  const preflight = orchestrator.currentTask?.preflightReport;
  if (!preflight?.tests?.length) return;

  const pfOk = preflight.tests.filter((t) => t.passed).length;
  const pfTotal = preflight.tests.length;
  const qaOk = qaReport.tests.filter((t) => t.passed).length;
  const qaTotal = qaReport.tests.length;
  const aligned = preflight.passed === qaReport.passed;

  orchestrator.log(
    'qa',
    `Paridade preflight↔QA: ${pfOk}/${pfTotal} → ${qaOk}/${qaTotal}`,
    aligned ? 'info' : 'warning'
  );

  if (!aligned) {
    const pfFail = preflight.tests.filter((t) => !t.passed).map((t) => t.name);
    const qaFail = qaReport.tests.filter((t) => !t.passed).map((t) => t.name);
    if (pfFail.length) {
      orchestrator.log('qa', `Falhas no preflight: ${pfFail.join(', ')}`, 'warning');
    }
    if (qaFail.length) {
      orchestrator.log('qa', `Falhas na QA formal: ${qaFail.join(', ')}`, 'warning');
    }
    if (preflight.passed && !qaReport.passed) {
      orchestrator.log(
        'qa',
        'Regressão detectada: preflight passou mas QA formal falhou — investigar flakiness ou diferença de ambiente.',
        'warning'
      );
    }
  }
}

module.exports = {
  execute: async (files, config, orchestrator) => {
    const { announceThinking, thinkAsSenior } = require('../lib/seniorEngineer');
    announceThinking(orchestrator, 'qa');

    const mobileReport = await runMobileSuite(files, config, orchestrator);
    let report;
    let suite;

    if (mobileReport) {
      report = mobileReport;
      suite = 'mobile-expo';
    } else {
      const sandboxRunner = require('../sandbox/runner');
      let sandboxInfo;

      try {
        sandboxInfo = await sandboxRunner.start(files, orchestrator);
      } catch (e) {
        orchestrator.log('qa', `Erro ao inicializar sandbox para testes: ${e.message}`, 'error');
        return {
          passed: false,
          tests: [{ name: 'Inicialização da Sandbox', passed: false, error: e.message }]
        };
      }

      const { runGeneratedTests, isValidCase } = require('../lib/testPlanRunner');
      const { getPlanTestCases } = require('../lib/architectPlan');
      const planCases = getPlanTestCases(orchestrator.savedPlan);

      if (planCases.length >= 2) {
        orchestrator.log(
          'qa',
          `Executando ${planCases.length} cenários aprovados no plano arquitetural (determinístico)...`,
          'info'
        );
        report = await runGeneratedTests({ cases: planCases }, sandboxInfo.baseUrl, orchestrator);
        suite = 'plan-approved';
        logPreflightQaParity(orchestrator, report);
      } else {
        let dynamicPlan = null;
        try {
          dynamicPlan = await generateTestPlan(files, config, orchestrator);
        } catch (err) {
          orchestrator.log('qa', `Geração de plano de teste dinâmico falhou (${err.message}); usando suíte fixa de fallback.`, 'warning');
        }
        const validCases = Array.isArray(dynamicPlan?.cases) ? dynamicPlan.cases.filter(isValidCase) : [];

        if (validCases.length >= 2) {
          orchestrator.log('qa', `Executando suíte de testes gerada dinamicamente a partir do código real (${validCases.length} casos)...`, 'info');
          report = await runGeneratedTests({ cases: validCases }, sandboxInfo.baseUrl, orchestrator);
          suite = 'dynamic';
        } else {
          suite = detectSuite(files);
          orchestrator.log('qa', 'Plano dinâmico vazio/insuficiente; usando suíte fixa de fallback.', 'warning');
          if (suite === 'rag') {
            orchestrator.log('qa', 'Executando suíte de testes RAG...', 'info');
            report = await runRagTests(sandboxInfo.baseUrl, orchestrator);
          } else if (suite === 'auth') {
            orchestrator.log('qa', 'Executando suíte de testes de Autenticação/JWT...', 'info');
            report = await runAuthTests(sandboxInfo.baseUrl, orchestrator);
          } else {
            orchestrator.log('qa', 'Executando suíte de testes CRUD de Tarefas...', 'info');
            report = await runCrudTests(sandboxInfo.baseUrl, orchestrator);
          }
        }
      }

      await sandboxRunner.stop(orchestrator);
    }

    const senior = await thinkAsSenior({
      role: 'qa',
      taskContract: `Revise os resultados de QA como um sênior de testes.
Identifique lacunas de cobertura, riscos de regressão e severidade das falhas.
Retorne APENAS JSON:
{
  "verdict": "aprovado|ressalvas|reprovado",
  "summary": "1-3 frases",
  "coverageGaps": ["caso ausente..."],
  "failureAnalysis": [{"test":"nome","rootCauseHint":"...","severity":"baixa|media|alta"}],
  "notesForDebugger": "o que o Depurador deve priorizar se houver falhas"
}`,
      userPayload: {
        suite,
        passed: report.passed,
        tests: report.tests,
        files: (files || []).map((f) => f.path)
      },
      runConfig: config,
      orchestrator
    });

    if (senior) {
      report.seniorReview = senior;
      if (senior.summary) {
        orchestrator.log('qa', `Sênior QA: ${senior.summary}`, senior.verdict === 'aprovado' ? 'success' : 'warning');
      }
      if (Array.isArray(senior.coverageGaps) && senior.coverageGaps.length) {
        orchestrator.log('qa', `Lacunas: ${senior.coverageGaps.slice(0, 3).join(' · ')}`, 'warning');
      }
    }

    if (report.passed) {
      orchestrator.log('qa', 'Todos os testes passaram com sucesso!', 'success');
    } else {
      orchestrator.log(
        'qa',
        `Alguns testes falharam: ${report.tests.filter((t) => !t.passed).length} falhas registradas.`,
        'error'
      );
    }

    return report;
  },
  __test__: { runCrudTests, runAuthTests, runRagTests, detectSuite, generateTestPlan }
};
