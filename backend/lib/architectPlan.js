const path = require('path');
const { isValidCase } = require('./testPlanRunner');

const EMPTY_PLAN = {
  files: [],
  adrs: [],
  apiContracts: [],
  dataModels: [],
  dependencies: [],
  nonFunctional: [],
  testScenarios: []
};

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .map((f) => {
      const filePath = f?.path || f?.filePath || f?.filename || f?.name;
      if (!filePath) return null;
      return {
        name: f.name || path.basename(filePath),
        path: filePath,
        purpose: typeof f.purpose === 'string' ? f.purpose.trim() : undefined
      };
    })
    .filter(Boolean);
}

function normalizeAdrs(adrs) {
  if (!Array.isArray(adrs)) return [];
  return adrs
    .map((adr) => {
      if (!adr?.id || !adr?.title) return null;
      return {
        id: String(adr.id).trim(),
        title: String(adr.title).trim(),
        status: String(adr.status || 'Proposto').trim(),
        context: String(adr.context || '').trim(),
        decision: String(adr.decision || '').trim(),
        consequences: String(adr.consequences || '').trim()
      };
    })
    .filter(Boolean);
}

function normalizeApiContracts(contracts) {
  if (!Array.isArray(contracts)) return [];
  return contracts
    .map((c) => {
      const routePath = c?.path || c?.route;
      const method = c?.method;
      if (!method || !routePath) return null;
      return {
        method: String(method).trim().toUpperCase(),
        path: String(routePath).trim(),
        description: String(c.description || '').trim(),
        auth: typeof c.auth === 'string' ? c.auth.trim() : c.auth === true ? 'required' : undefined,
        request: c.request ?? undefined,
        response: c.response ?? undefined
      };
    })
    .filter(Boolean);
}

function normalizeDataModels(models) {
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => {
      const name = m?.name;
      if (!name) return null;
      const fields = Array.isArray(m.fields)
        ? m.fields
            .map((f) => {
              if (!f?.name) return null;
              return {
                name: String(f.name).trim(),
                type: String(f.type || 'string').trim(),
                required: Boolean(f.required),
                description: typeof f.description === 'string' ? f.description.trim() : undefined
              };
            })
            .filter(Boolean)
        : [];
      return {
        name: String(name).trim(),
        description: typeof m.description === 'string' ? m.description.trim() : undefined,
        fields
      };
    })
    .filter(Boolean);
}

function normalizeDependencies(deps) {
  if (!Array.isArray(deps)) return [];
  return deps
    .map((d) => {
      const name = typeof d === 'string' ? d : d?.name;
      if (!name) return null;
      return {
        name: String(name).trim(),
        version: d?.version ? String(d.version).trim() : undefined,
        reason: typeof d.reason === 'string' ? d.reason.trim() : undefined
      };
    })
    .filter(Boolean);
}

function normalizeNonFunctional(nf) {
  if (Array.isArray(nf)) {
    return nf
      .map((item) => {
        if (typeof item === 'string' && item.trim()) {
          return { area: 'geral', requirement: item.trim() };
        }
        if (item?.requirement) {
          return {
            area: String(item.area || 'geral').trim(),
            requirement: String(item.requirement).trim()
          };
        }
        return null;
      })
      .filter(Boolean);
  }
  if (nf && typeof nf === 'object') {
    return Object.entries(nf)
      .map(([area, requirement]) => {
        if (!requirement) return null;
        return {
          area: String(area).trim(),
          requirement: String(requirement).trim()
        };
      })
      .filter(Boolean);
  }
  return [];
}

function contractRequiresAuth(auth) {
  if (auth === true || auth === 'required') return true;
  if (typeof auth === 'string' && auth !== 'false' && auth.toLowerCase() !== 'false') return true;
  return false;
}

function sampleBodyFromRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return {};
  const body = {};
  for (const [key, typeHint] of Object.entries(request)) {
    const hint = String(typeHint).toLowerCase();
    if (key === 'email') body.email = `qa.${Date.now()}@test.com`;
    else if (key === 'password') body.password = 'Password123!';
    else if (key === 'name') body.name = 'QA Engineer';
    else if (key === 'title') body.title = 'Tarefa de teste';
    else if (hint.includes('bool')) body[key] = false;
    else if (hint.includes('number') || hint.includes('integer')) body[key] = 1;
    else body[key] = 'test';
  }
  return body;
}

function defaultExpectedStatus(method) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'POST') return '2xx';
  if (m === 'DELETE') return '2xx';
  return '2xx';
}

function normalizeTestScenario(scenario) {
  if (!scenario?.path || !scenario?.method) return null;
  const routePath = String(scenario.path).trim();
  if (!routePath.startsWith('/')) return null;
  const method = String(scenario.method).trim().toUpperCase();
  if (!HTTP_METHODS.has(method)) return null;

  const authRaw = scenario.auth;
  let auth = false;
  if (authRaw === true || authRaw === 'true') auth = true;
  else if (typeof authRaw === 'string' && authRaw !== 'false') auth = true;

  return {
    name: String(scenario.name || `${method} ${routePath}`).trim(),
    method,
    path: routePath,
    body: scenario.body === null ? null : scenario.body ?? undefined,
    auth,
    expectedStatus: scenario.expectedStatus
      ? String(scenario.expectedStatus).trim()
      : defaultExpectedStatus(method),
    expect: scenario.expect ? String(scenario.expect).trim() : 'none',
    captureAs: scenario.captureAs ? String(scenario.captureAs).trim() : undefined
  };
}

function normalizeTestScenarios(scenarios) {
  if (!Array.isArray(scenarios)) return [];
  return scenarios.map(normalizeTestScenario).filter(Boolean);
}

/**
 * Deriva cenários mínimos a partir de contratos quando o arquiteto não entregou o mínimo (2).
 */
function deriveTestScenariosFromContracts(apiContracts, existing = []) {
  const scenarios = [...existing];
  const seen = new Set(scenarios.map((s) => `${s.method} ${s.path}`));

  const add = (scenario) => {
    const normalized = normalizeTestScenario(scenario);
    if (!normalized) return;
    const key = `${normalized.method} ${normalized.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    scenarios.push(normalized);
  };

  if (!seen.has('GET /health') && !seen.has('GET /api/health')) {
    add({
      name: 'Healthcheck operacional',
      method: 'GET',
      path: '/health',
      expectedStatus: '200',
      expect: 'none'
    });
  }

  for (const contract of apiContracts || []) {
    const requiresAuth = contractRequiresAuth(contract.auth);
    const lower = contract.path.toLowerCase();

    if (contract.method === 'POST' && !requiresAuth) {
      const expectToken = lower.includes('login') || lower.includes('auth');
      add({
        name: `${contract.description || contract.path} — sucesso`,
        method: 'POST',
        path: contract.path,
        body: sampleBodyFromRequest(contract.request),
        expectedStatus: '2xx',
        expect: expectToken ? 'token' : 'object-id',
        captureAs: expectToken ? undefined : 'createdId'
      });

      if (lower.includes('register')) {
        add({
          name: `${contract.description || contract.path} — validação 4xx`,
          method: 'POST',
          path: contract.path,
          body: { email: 'incomplete@test.com' },
          expectedStatus: '4xx',
          expect: 'none'
        });
      }
    }

    if (contract.method === 'GET' && requiresAuth) {
      add({
        name: `${contract.description || contract.path} — autenticado`,
        method: 'GET',
        path: contract.path,
        auth: true,
        expectedStatus: '200',
        expect: 'object-id'
      });
      add({
        name: `${contract.description || contract.path} — sem token`,
        method: 'GET',
        path: contract.path,
        auth: false,
        expectedStatus: '401',
        expect: 'none'
      });
    }

    if (contract.method === 'GET' && !requiresAuth && contract.path !== '/health') {
      add({
        name: `${contract.description || contract.path} — listar`,
        method: 'GET',
        path: contract.path,
        expectedStatus: '200',
        expect: 'list'
      });
    }
  }

  return scenarios;
}

function ensureMinimumTestScenarios(plan) {
  let scenarios = normalizeTestScenarios(plan.testScenarios);
  if (scenarios.length < 2) {
    scenarios = deriveTestScenariosFromContracts(plan.apiContracts, scenarios);
  }
  return scenarios;
}

/**
 * Normaliza o plano arquitetural completo (schema enriquecido + retrocompatível).
 */
function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') {
    return structuredClone(EMPTY_PLAN);
  }
  const normalized = {
    files: normalizeFiles(plan.files),
    adrs: normalizeAdrs(plan.adrs),
    apiContracts: normalizeApiContracts(plan.apiContracts),
    dataModels: normalizeDataModels(plan.dataModels),
    dependencies: normalizeDependencies(plan.dependencies),
    nonFunctional: normalizeNonFunctional(plan.nonFunctional),
    testScenarios: normalizeTestScenarios(plan.testScenarios)
  };
  normalized.testScenarios = ensureMinimumTestScenarios(normalized);
  if (plan.seniorReview && typeof plan.seniorReview === 'object') {
    normalized.seniorReview = plan.seniorReview;
  }
  return normalized;
}

function mergeByKey(existing, incoming, keyFn) {
  const map = new Map();
  for (const item of existing || []) {
    map.set(keyFn(item), item);
  }
  for (const item of incoming || []) {
    map.set(keyFn(item), { ...(map.get(keyFn(item)) || {}), ...item });
  }
  return [...map.values()];
}

/**
 * Mescla emendas da revisão sênior sem duplicar entradas.
 */
function mergePlanAmendments(plan, amendments) {
  if (!amendments || typeof amendments !== 'object') return plan;
  const base = normalizePlan({ ...plan, testScenarios: plan.testScenarios || [] });
  const merged = {
    ...base,
    files: mergeByKey(base.files, amendments.files, (f) => f.path),
    adrs: mergeByKey(base.adrs, amendments.adrs, (a) => a.id),
    apiContracts: mergeByKey(
      base.apiContracts,
      amendments.apiContracts,
      (c) => `${c.method} ${c.path}`
    ),
    dataModels: mergeByKey(base.dataModels, amendments.dataModels, (m) => m.name),
    dependencies: mergeByKey(base.dependencies, amendments.dependencies, (d) => d.name),
    nonFunctional: mergeByKey(
      base.nonFunctional,
      normalizeNonFunctional(amendments.nonFunctional),
      (n) => `${n.area}:${n.requirement}`
    ),
    testScenarios: mergeByKey(
      base.testScenarios,
      normalizeTestScenarios(amendments.testScenarios),
      (s) => `${s.method} ${s.path}:${s.name}`
    )
  };
  merged.testScenarios = ensureMinimumTestScenarios(merged);
  return normalizePlan(merged);
}

/**
 * Casos executáveis pelo testPlanRunner a partir do plano aprovado.
 */
function getPlanTestCases(plan) {
  const scenarios = normalizePlan(plan).testScenarios;
  return scenarios.filter(isValidCase);
}

/**
 * Handoff explícito para o Codificador — ADRs, contratos, modelos, NFRs e cenários QA.
 */
function buildCoderHandoff(plan) {
  const p = normalizePlan(plan);
  const sections = [
    'CONTEXTO ARQUITETURAL APROVADO (obrigatório seguir):',
    '',
    `Arquivos planejados (${p.files.length}):`,
    JSON.stringify(
      p.files.map(({ name, path: filePath, purpose }) =>
        purpose ? { name, path: filePath, purpose } : { name, path: filePath }
      ),
      null,
      2
    )
  ];

  if (p.adrs.length) {
    sections.push('', `ADRs (${p.adrs.length}) — implemente conforme as decisões:`);
    sections.push(JSON.stringify(p.adrs, null, 2));
  }
  if (p.apiContracts.length) {
    sections.push('', `Contratos de API (${p.apiContracts.length}) — rotas, métodos e payloads:`);
    sections.push(JSON.stringify(p.apiContracts, null, 2));
  }
  if (p.dataModels.length) {
    sections.push('', `Modelos de dados (${p.dataModels.length}):`);
    sections.push(JSON.stringify(p.dataModels, null, 2));
  }
  if (p.dependencies.length) {
    sections.push('', `Dependências aprovadas (${p.dependencies.length}):`);
    sections.push(JSON.stringify(p.dependencies, null, 2));
  }
  if (p.nonFunctional.length) {
    sections.push('', `Requisitos não-funcionais (${p.nonFunctional.length}):`);
    sections.push(JSON.stringify(p.nonFunctional, null, 2));
  }
  if (p.testScenarios.length) {
    sections.push(
      '',
      `Cenários de teste aprovados (${p.testScenarios.length}) — o QA executará estes casos; implemente para PASSAR:`
    );
    sections.push(JSON.stringify(p.testScenarios, null, 2));
    sections.push(
      '',
      'ENVELOPE DE RESPOSTA (obrigatório para APIs HTTP):',
      '- Sucesso: { "success": true, "data": <payload> } com status 2xx adequado (201 em POST de criação).',
      '- Erro de validação/cliente: { "success": false, "error": "<mensagem clara>" } com status 4xx.',
      '- Erro interno: { "success": false, "error": "..." } com status 500 — nunca vaze stack trace.',
      '- Tokens JWT: campo "token" ou dentro de "data.token" / "data.accessToken" (QA aceita variações razoáveis).',
      '- Listagens: array em "data" ou na raiz — seja consistente em TODAS as rotas do mesmo recurso.'
    );
  }
  if (p.seniorReview?.summary) {
    sections.push('', 'Notas da revisão arquitetural sênior:');
    sections.push(String(p.seniorReview.summary));
    if (Array.isArray(p.seniorReview.risks) && p.seniorReview.risks.length) {
      sections.push('', 'Riscos a mitigar na implementação:');
      sections.push(p.seniorReview.risks.map((r) => `- ${r}`).join('\n'));
    }
  }

  sections.push(
    '',
    'Implemente EXATAMENTE esta arquitetura. Não invente rotas, modelos ou dependências fora do plano sem necessidade.'
  );
  return sections.join('\n');
}

function summarizePlan(plan) {
  const p = normalizePlan(plan);
  const parts = [`${p.files.length} arquivos`, `${p.adrs.length} ADRs`];
  if (p.apiContracts.length) parts.push(`${p.apiContracts.length} contratos API`);
  if (p.dataModels.length) parts.push(`${p.dataModels.length} modelos de dados`);
  if (p.dependencies.length) parts.push(`${p.dependencies.length} dependências`);
  if (p.nonFunctional.length) parts.push(`${p.nonFunctional.length} NFRs`);
  if (p.testScenarios.length) parts.push(`${p.testScenarios.length} cenários QA`);
  return parts.join(', ');
}

module.exports = {
  EMPTY_PLAN,
  normalizePlan,
  mergePlanAmendments,
  buildCoderHandoff,
  summarizePlan,
  getPlanTestCases,
  normalizeTestScenario,
  deriveTestScenariosFromContracts
};
