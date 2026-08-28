const { generateJson } = require('../lib/llm');
const { composeSystemPrompt, announceThinking, thinkAsSenior } = require('../lib/seniorEngineer');

const MAX_STEPS = 12;
const STEP_TIMEOUT_MS = 20000;

function baseUrl(deployUrl) {
  return String(deployUrl || '').replace(/\/$/, '');
}

function extractRoutesFromFiles(files = []) {
  const routes = new Set();
  const routeRe =
    /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
  const fetchRe = /fetch\(\s*[`'"](\/[^`'"]+)[`'"]/gi;
  const pathHintRe = /['"`](\/(?:api\/)?[a-z0-9/_.:-]+)['"`]/gi;

  for (const file of files.slice(0, 60)) {
    const content = String(file?.content || '');
    if (!content) continue;
    let m;
    while ((m = routeRe.exec(content))) {
      routes.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
    while ((m = fetchRe.exec(content))) {
      routes.add(`FETCH ${m[1]}`);
    }
    if (/\.(html|js|tsx?|jsx)$/i.test(file.path || '')) {
      while ((m = pathHintRe.exec(content))) {
        if (m[1].startsWith('/api') || m[1] === '/') routes.add(`HINT ${m[1]}`);
      }
    }
  }
  return [...routes].slice(0, 80);
}

function summarizeHtml(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title = (String(html).match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const buttons = [...String(html).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
    .slice(0, 20);
  const inputs = [...String(html).matchAll(/<(input|textarea)[^>]*>/gi)]
    .map((m) => m[0].slice(0, 160))
    .slice(0, 20);
  const fetchPaths = [...String(html).matchAll(/fetch\(\s*[`'"](\/[^`'"]+)[`'"]/gi)].map(
    (m) => m[1]
  );
  return {
    title: title.trim(),
    visibleText: text.slice(0, 1800),
    buttons,
    inputs,
    fetchPaths: [...new Set(fetchPaths)].slice(0, 30)
  };
}

/** Jar mínimo pra manter a sessão entre passos — cada httpStep() usava fetch() isolado, então
 * um cookie de sessão setado no login nunca chegava aos passos seguintes (a API rejeitava
 * tudo depois do login como se nunca tivesse autenticado). */
function makeCookieJar() {
  const jar = new Map();
  return {
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    absorb(res) {
      const setCookies =
        typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      for (const raw of setCookies) {
        const pair = raw.split(';', 1)[0];
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    }
  };
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function httpStep(base, step, orchestrator, cookieJar) {
  const method = String(step.method || step.action || 'GET').toUpperCase();
  const path = step.path || '/';
  const started0 = Date.now();

  // `path` vem de JSON gerado pelo LLM (a "jornada" de teste humano) — sem essa checagem, uma
  // URL absoluta pra um host diferente do deploy sendo testado seria seguida direto, levando
  // junto o cookie de sessão e as credenciais reais (`knownCredentials`) anexadas mais abaixo.
  // Isso é SSRF + exfiltração de segredo via prompt injection no próprio código do projeto, não
  // um caso hipotético: o LLM só precisa emitir `{ "path": "http://attacker/..." }`.
  if (/^https?:\/\//i.test(path)) {
    const baseOrigin = safeOrigin(base);
    const stepOrigin = safeOrigin(path);
    if (!baseOrigin || stepOrigin !== baseOrigin) {
      orchestrator.log(
        'human',
        `${step.asHuman || step.id || path}: passo bloqueado — URL absoluta fora do host testado (${path})`,
        'warning'
      );
      return {
        ok: false,
        status: 0,
        ms: Date.now() - started0,
        failure: `URL absoluta fora do host testado: ${path}`,
        bodyPreview: ''
      };
    }
  }

  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { Accept: 'application/json, text/html, */*', ...(step.headers || {}) };
  // Cookie/credenciais só valem pro host que está sendo testado de verdade — nunca pra um alvo
  // que a checagem acima já teria bloqueado, mas a dupla checagem custa nada e documenta a intenção.
  const cookieHeader = safeOrigin(url) === safeOrigin(base) ? cookieJar?.header() : null;
  if (cookieHeader) headers.Cookie = cookieHeader;
  let body;
  if (step.body != null && !['GET', 'HEAD'].includes(method)) {
    if (typeof step.body === 'string') {
      body = step.body;
    } else {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(step.body);
    }
  }

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(Number(step.timeoutMs) || STEP_TIMEOUT_MS)
    });
    cookieJar?.absorb(res);
    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();
    let json = null;
    if (contentType.includes('json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
    }

    const result = {
      ok: res.ok,
      status: res.status,
      contentType,
      ms: Date.now() - started,
      bodyPreview: raw.slice(0, 2000),
      json
    };

    const expectStatus = step.expectStatus || (step.expectOk === false ? null : [200, 201, 204]);
    if (Array.isArray(expectStatus) && expectStatus.length) {
      if (!expectStatus.includes(res.status)) {
        result.ok = false;
        result.failure = `Esperava HTTP ${expectStatus.join('|')}, recebi ${res.status}`;
      } else {
        // Status esperado (ex.: 401/404 em sonda) conta como ok mesmo se res.ok for false
        result.ok = true;
      }
    } else if (step.expectOk === false) {
      result.ok = true;
    }
    if (step.expectContains) {
      const needles = Array.isArray(step.expectContains) ? step.expectContains : [step.expectContains];
      for (const needle of needles) {
        if (!raw.toLowerCase().includes(String(needle).toLowerCase())) {
          result.ok = false;
          result.failure = `Não encontrei na resposta: "${needle}"`;
          break;
        }
      }
    }
    if (step.expectJsonKey && (json == null || !(step.expectJsonKey in json))) {
      result.ok = false;
      result.failure = `JSON sem chave "${step.expectJsonKey}"`;
    }
    if (step.expectTruthyKey && json && !json[step.expectTruthyKey]) {
      result.ok = false;
      result.failure = `Esperava ${step.expectTruthyKey} truthy`;
    }

    orchestrator.log(
      'human',
      `${step.asHuman || step.id || path}: ${method} ${path} → ${res.status} (${result.ms}ms)${
        result.failure ? ` — ${result.failure}` : ''
      }`,
      result.ok ? 'info' : 'warning'
    );
    return result;
  } catch (err) {
    orchestrator.log(
      'human',
      `${step.asHuman || path}: falhou — ${err.message}`,
      'error'
    );
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      failure: err.message,
      bodyPreview: ''
    };
  }
}

function pickEntryPath(surface) {
  const probes = Array.isArray(surface.probes) ? surface.probes : [];
  const homeOk = probes.find((p) => p.path === '/' && p.ok);
  if (homeOk) {
    return {
      path: '/',
      asHuman: 'Abro a página inicial como um usuário comum',
      expectContains: surface.html?.title ? [surface.html.title.split(/\s+/)[0]] : undefined
    };
  }

  const healthOk =
    probes.find((p) => p.path === '/api/health' && p.ok) ||
    probes.find((p) => p.path === '/health' && p.ok);
  if (healthOk) {
    return {
      path: healthOk.path,
      asHuman: 'Abro o healthcheck como entrada (API sem UI pública em /)',
      expectContains: undefined
    };
  }

  const routePaths = (surface.routes || [])
    .map((r) => String(r).replace(/^(GET|POST|PUT|PATCH|DELETE|FETCH|HINT)\s+/i, ''))
    .filter((p) => p.startsWith('/'));
  if (routePaths.some((p) => p === '/api/health' || p === '/health')) {
    return {
      path: routePaths.includes('/api/health') ? '/api/health' : '/health',
      asHuman: 'Abro o healthcheck como entrada (API sem UI pública em /)',
      expectContains: undefined
    };
  }

  return {
    path: '/',
    asHuman: 'Abro a página inicial como um usuário comum',
    expectContains: surface.html?.title ? [surface.html.title.split(/\s+/)[0]] : undefined
  };
}

function heuristicJourney(surface) {
  const paths = new Set([
    ...(surface.html?.fetchPaths || []),
    ...(surface.routes || [])
      .map((r) => String(r).replace(/^(GET|POST|PUT|PATCH|DELETE|FETCH|HINT)\s+/i, ''))
      .filter((p) => p.startsWith('/'))
  ]);

  const entry = pickEntryPath(surface);
  const steps = [
    {
      id: 'open-home',
      asHuman: entry.asHuman,
      action: 'GET',
      path: entry.path,
      expectStatus: [200],
      expectContains: entry.expectContains
    }
  ];

  // Evita duplicar health se a entrada já foi o healthcheck
  if (entry.path !== '/api/health' && entry.path !== '/health') {
    steps.push({
      id: 'health',
      asHuman: 'Verifico se o serviço está no ar (health)',
      action: 'GET',
      path: paths.has('/health') && !paths.has('/api/health') ? '/health' : '/api/health',
      expectStatus: [200]
    });
  }

  if ([...paths].some((p) => p.includes('/documents')) || paths.has('/api/documents')) {
    steps.push({
      id: 'list-docs',
      asHuman: 'Listo os documentos já disponíveis, como faria na UI',
      action: 'GET',
      path: '/api/documents',
      expectStatus: [200]
    });
  }

  if ([...paths].some((p) => p.includes('/ingest'))) {
    steps.push({
      id: 'ingest-text',
      asHuman: 'Indexo um texto curto pelo mesmo fluxo da tela “Indexar texto”',
      action: 'POST',
      path: '/api/ingest/text',
      body: {
        title: 'Teste humanístico ForjaIA',
        source: 'human-inloco.txt',
        text: 'ForjaIA validou este fluxo in loco. O humano simulou a ingestão de um documento curto para checar o pipeline.'
      },
      expectStatus: [200, 201]
    });
  }

  if ([...paths].some((p) => p.includes('/query'))) {
    steps.push({
      id: 'query',
      asHuman: 'Faço uma pergunta real na caixa de consulta da UI',
      action: 'POST',
      path: '/api/query',
      body: {
        query: 'O que é o ForjaIA e o que este documento de teste menciona?',
        generate: false
      },
      expectStatus: [200]
    });
  }

  // Generic POST/GET extras from discovered API paths
  for (const p of [...paths]) {
    if (!p.startsWith('/api')) continue;
    if (['/api/health', '/api/documents', '/api/ingest/text', '/api/query', '/api'].includes(p)) {
      continue;
    }
    if (steps.length >= 8) break;
    if (p.includes('ingest/file')) continue;
    steps.push({
      id: `probe-${steps.length}`,
      asHuman: `Exploro o endpoint ${p} como usuário curioso`,
      action: 'GET',
      path: p,
      expectOk: false,
      expectStatus: [200, 201, 400, 401, 404, 405]
    });
  }

  return {
    persona: 'Usuário humano testando o produto no ambiente implantado',
    goal: 'Validar o fluxo principal in loco: abrir tela, saúde, ações da UI e resultado útil',
    steps: steps.slice(0, MAX_STEPS)
  };
}

async function planHumanJourney({ deployUrl, surface, files, runConfig, orchestrator, credentials }) {
  const hasCredentials = credentials && Object.keys(credentials).length > 0;
  const system = composeSystemPrompt(
    'human',
    `Você É um humano real (não um bot de monitoramento) usando o produto implantado.
Planeje um roteiro IN LOCO curto para validar o fluxo e o funcionamento do projeto.
Cada passo deve ser executável via HTTP (o que a UI faria ao clicar/enviar).
Não invente endpoints inexistentes. Prefira o caminho feliz do usuário + 1 checagem negativa leve se fizer sentido.
${
  hasCredentials
    ? `O deploy real tem estas variáveis de ambiente (userPayload.knownCredentials) — se o fluxo exigir login/API
key, use o valor REAL que fizer sentido pro campo que a rota espera (nunca invente um valor de teste tipo
"test-token"); nunca envie SECRET de assinatura de sessão/JWT como se fosse credencial de usuário.`
    : ''
}
Retorne APENAS JSON:
{
  "persona": "quem você é nesta sessão",
  "goal": "o que quer validar",
  "steps": [
    {
      "id": "s1",
      "asHuman": "narração em 1ª pessoa do que está fazendo",
      "action": "GET|POST|PUT|PATCH|DELETE",
      "path": "/...",
      "body": {},
      "expectStatus": [200],
      "expectContains": ["texto opcional"],
      "expectJsonKey": "opcional",
      "expectTruthyKey": "opcional"
    }
  ]
}
Máximo ${MAX_STEPS} passos. Sem autenticação inventada se o app não exigir.`,
    runConfig
  );

  try {
    const result = await generateJson({
      system,
      user: JSON.stringify({
        deployUrl,
        surface,
        knownCredentials: credentials || {},
        fileMap: (files || []).slice(0, 35).map((f) => ({
          path: f.path,
          preview: String(f.content || '').slice(0, 900)
        }))
      }),
      runConfig,
      signal: orchestrator.getSignal()
    });
    if (result.tokens) {
      orchestrator.recordTokens(result.tokens, {
        provider: result.provider,
        model: result.model
      });
    }
    const plan = result.data;
    const steps = Array.isArray(plan?.steps)
      ? plan.steps
      : Array.isArray(plan?.journey)
        ? plan.journey
        : Array.isArray(plan?.actions)
          ? plan.actions
          : [];
    if (!steps.length) throw new Error('Plano sem passos');
    return {
      persona: plan.persona || plan.role || 'Usuário humano',
      goal: plan.goal || plan.objective || 'Testar fluxo principal',
      steps: steps.slice(0, MAX_STEPS).map((s, i) => ({
        id: s.id || `s${i + 1}`,
        asHuman: s.asHuman || s.narration || s.description || `Passo ${i + 1}`,
        action: String(s.action || s.method || 'GET').toUpperCase(),
        path: s.path || s.url || '/',
        body: s.body,
        headers: s.headers,
        expectStatus: s.expectStatus,
        expectContains: s.expectContains,
        expectJsonKey: s.expectJsonKey,
        expectTruthyKey: s.expectTruthyKey,
        timeoutMs: s.timeoutMs
      })),
      source: 'llm'
    };
  } catch (err) {
    orchestrator.log(
      'human',
      `Plano LLM indisponível (${err.message}); usando jornada heurística in loco.`,
      'warning'
    );
    return { ...heuristicJourney(surface), source: 'heuristic' };
  }
}

async function discoverSurface(deployUrl, files, orchestrator) {
  const base = baseUrl(deployUrl);
  const surface = {
    reachable: false,
    routes: extractRoutesFromFiles(files),
    html: null,
    apiCatalog: null,
    probes: []
  };

  if (!base) {
    surface.findings = [
      {
        id: 'UX-NO-URL',
        severity: 'CRITICAL',
        title: 'Deploy sem URL',
        description: 'Não há URL para teste in loco.',
        remediation: 'Reexecutar o deploy antes da verificação humana.'
      }
    ];
    return surface;
  }

  try {
    const home = await fetch(`${base}/`, { signal: AbortSignal.timeout(8000) });
    const html = await home.text();
    surface.probes.push({ path: '/', status: home.status, ok: home.ok });
    surface.reachable = home.ok;
    surface.html = summarizeHtml(html);
    orchestrator.log(
      'human',
      `Abri a home: HTTP ${home.status}${surface.html.title ? ` — “${surface.html.title}”` : ''}`,
      home.ok ? 'info' : 'warning'
    );
  } catch (err) {
    surface.probes.push({ path: '/', error: err.message, ok: false });
    orchestrator.log('human', `Não consegui abrir a home: ${err.message}`, 'error');
  }

  try {
    const api = await fetch(`${base}/api`, { signal: AbortSignal.timeout(5000) });
    if (api.ok) {
      const text = await api.text();
      try {
        surface.apiCatalog = JSON.parse(text);
      } catch {
        surface.apiCatalog = text.slice(0, 500);
      }
      surface.probes.push({ path: '/api', status: api.status, ok: true });
    }
  } catch {
    // optional
  }

  for (const healthPath of ['/api/health', '/health']) {
    try {
      const health = await fetch(`${base}${healthPath}`, { signal: AbortSignal.timeout(5000) });
      const preview = (await health.text()).slice(0, 500);
      surface.probes.push({
        path: healthPath,
        status: health.status,
        ok: health.ok,
        preview
      });
      if (health.ok) surface.reachable = true;
    } catch (err) {
      surface.probes.push({ path: healthPath, error: err.message, ok: false });
    }
  }

  return surface;
}

module.exports = {
  execute: async (deployUrl, files, runConfig, orchestrator, deployedEnv = {}) => {
    orchestrator.throwIfAborted();
    // Só credenciais plausivelmente fornecidas pelo cliente (API_TOKEN/API_KEY) — nunca
    // segredos de assinatura interna (JWT_SECRET/SESSION_SECRET), que um usuário real nunca
    // digitaria numa tela de login.
    const credentials = Object.fromEntries(
      Object.entries(deployedEnv || {}).filter(
        ([k]) => /TOKEN|KEY/i.test(k) && !/JWT_SECRET|SESSION_SECRET/i.test(k)
      )
    );
    announceThinking(orchestrator, 'human');
    orchestrator.log(
      'human',
      'Entrando in loco como usuário humano: vou usar o projeto implantado de ponta a ponta…',
      'info'
    );

    const surface = await discoverSurface(deployUrl, files, orchestrator);
    orchestrator.throwIfAborted();

    if (!surface.reachable) {
      const issues = surface.findings || [
        {
          id: 'UX-UNREACHABLE',
          severity: 'CRITICAL',
          title: 'App inacessível para teste humano',
          description: 'Não foi possível abrir o deploy para validar o fluxo in loco.',
          remediation: 'Garantir que o deploy está no ar e a URL está correta.'
        }
      ];
      return {
        passed: false,
        deployUrl,
        issues,
        surface,
        session: null,
        notesForUserFix: 'Corrigir disponibilidade do deploy antes de retestar o fluxo humano.'
      };
    }

    const plan = await planHumanJourney({
      deployUrl,
      surface,
      files,
      runConfig,
      orchestrator,
      credentials
    });
    orchestrator.throwIfAborted();

    orchestrator.log(
      'human',
      `Persona: ${plan.persona}. Objetivo: ${plan.goal} (${plan.steps.length} passos, via ${plan.source}).`,
      'info'
    );

    const transcript = [];
    const stepResults = [];
    const cookieJar = makeCookieJar();
    for (const step of plan.steps) {
      orchestrator.throwIfAborted();
      const asHuman = step.asHuman || `Executo ${step.action || 'GET'} ${step.path}`;
      transcript.push({ role: 'human', text: asHuman });
      const result = await httpStep(baseUrl(deployUrl), step, orchestrator, cookieJar);
      stepResults.push({ step, result });
      transcript.push({
        role: 'system',
        text: result.ok
          ? `Ok (${result.status})`
          : `Falhou: ${result.failure || `HTTP ${result.status}`}`
      });
    }

    const failedSteps = stepResults.filter((s) => !s.result.ok);
    const issues = failedSteps.map((s, idx) => ({
      id: `HUMAN-FLOW-${s.step.id || idx + 1}`,
      severity: s.result.status >= 500 || s.result.status === 0 ? 'HIGH' : 'MEDIUM',
      title: `Falha no fluxo humano: ${s.step.asHuman || s.step.path}`,
      description: `${s.result.failure || `HTTP ${s.result.status}`} · ${String(s.result.bodyPreview || '').slice(0, 400)}`,
      remediation: 'Corrigir o endpoint/fluxo da UI correspondente e reexecutar o teste humano in loco.',
      file: undefined
    }));

    const senior = await thinkAsSenior({
      role: 'human',
      taskContract: `Você acabou de testar IN LOCO como humano. Avalie se o fluxo e o funcionamento do projeto estão ok.
Só reporte problemas com evidência na sessão (transcript/passos).
Retorne APENAS JSON:
{
  "verdict": "aprovado|ressalvas|reprovado",
  "summary": "1-3 frases em 1ª pessoa, tom humano",
  "issues": [{"id":"UX-...","severity":"LOW|MEDIUM|HIGH|CRITICAL","title":"...","description":"...","remediation":"...","file":"path?"}],
  "notesForUserFix": "instruções práticas para o corretor"
}`,
      userPayload: {
        deployUrl,
        plan,
        surface: {
          title: surface.html?.title,
          buttons: surface.html?.buttons,
          routes: surface.routes?.slice(0, 40),
          apiCatalog: surface.apiCatalog
        },
        stepResults: stepResults.map(({ step, result }) => ({
          id: step.id,
          asHuman: step.asHuman,
          path: step.path,
          action: step.action || step.method,
          ok: result.ok,
          status: result.status,
          failure: result.failure || null,
          preview: String(result.bodyPreview || '').slice(0, 500)
        })),
        transcript
      },
      runConfig,
      orchestrator
    });

    if (Array.isArray(senior?.issues)) {
      for (const issue of senior.issues) {
        if (!issue?.title) continue;
        issues.push({
          id: issue.id || `UX-LLM-${issues.length + 1}`,
          severity: issue.severity || 'MEDIUM',
          title: issue.title,
          description: issue.description || '',
          remediation: issue.remediation || '',
          file: issue.file
        });
      }
    }

    const critical = issues.some((i) =>
      ['HIGH', 'CRITICAL'].includes(String(i.severity || '').toUpperCase())
    );
    const flowOk = failedSteps.length === 0;
    // Achado real: a variável `passed` original checava o verdict do LLM ('aprovado'/'ressalvas'/
    // sem-verdict-e-sem-issues) mas era sempre um subconjunto de `flowOk && !critical &&
    // surface.reachable` — `passed || X` sempre reduzia pra `X`, então aquela checagem nunca
    // influenciava o resultado (código morto). Na prática, o único jeito do LLM vetar um teste
    // humano de resto limpo era bater o literal exato 'reprovado' abaixo — qualquer variação de
    // formatação ("Reprovado", "reprovado.") passava batido. Normaliza o verdict em vez de
    // comparar string exata.
    const seniorRejected = String(senior?.verdict || '').trim().toLowerCase().startsWith('reprovado');
    const finalPassed = !seniorRejected && flowOk && !critical && surface.reachable;

    if (senior?.summary) {
      orchestrator.log(
        'human',
        senior.summary,
        finalPassed ? 'success' : 'warning'
      );
    }

    orchestrator.log(
      'human',
      finalPassed
        ? `Teste humano in loco OK (${stepResults.length - failedSteps.length}/${stepResults.length} passos).`
        : `Teste humano in loco com problemas: ${failedSteps.length} passo(s) falhou(aram), ${issues.length} achado(s).`,
      finalPassed ? 'success' : 'warning'
    );

    return {
      passed: Boolean(finalPassed),
      deployUrl,
      issues,
      surface,
      session: {
        persona: plan.persona,
        goal: plan.goal,
        planSource: plan.source,
        transcript,
        steps: stepResults.map(({ step, result }) => ({
          id: step.id,
          asHuman: step.asHuman,
          path: step.path,
          action: step.action || step.method,
          ok: result.ok,
          status: result.status,
          ms: result.ms,
          failure: result.failure || null
        }))
      },
      notesForUserFix: senior?.notesForUserFix || '',
      seniorReview: senior || null
    };
  },
  __test__: { httpStep, safeOrigin }
};
