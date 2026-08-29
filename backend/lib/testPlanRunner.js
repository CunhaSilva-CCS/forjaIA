/**
 * Executor genérico de um plano de teste HTTP gerado dinamicamente (ver ADR-036). Roda uma lista
 * de casos {method, path, body, auth, expectedStatus, expect, captureAs} contra um baseUrl real,
 * encadeando valores capturados (id criado, token) entre casos via {variavel} no path.
 *
 * As checagens de corpo ("expect") são deliberadamente tolerantes a várias convenções de envelope
 * — não exigem um nome de campo específico. Essa é a lição do ADR-034 (QA travava numa única
 * convenção de campo e reprovava código correto) aplicada aqui de propósito: como o plano é gerado
 * por um LLM que só viu o contrato abstrato do projeto, exigir um envelope exato reintroduziria o
 * mesmo bug por um caminho novo.
 */

function matchesStatus(status, expected) {
  if (expected === undefined || expected === null || expected === '') return true;
  const spec = String(expected).trim();
  if (spec.includes(',')) return spec.split(',').some((s) => matchesStatus(status, s.trim()));
  const classMatch = spec.match(/^(\d)xx$/i);
  if (classMatch) return Math.floor(status / 100) === Number(classMatch[1]);
  if (/^\d{3}$/.test(spec)) return status === Number(spec);
  return String(status) === spec;
}

function pickList(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['tasks', 'data', 'items', 'results', 'todos', 'matches', 'list']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return null;
}

function pickObjectWithId(data) {
  if (data && typeof data === 'object' && !Array.isArray(data) && data.id !== undefined) return data;
  for (const key of ['task', 'data', 'item', 'user', 'result', 'todo']) {
    const nested = data?.[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested) && nested.id !== undefined) return nested;
  }
  return null;
}

function pickToken(data) {
  return data?.token || data?.accessToken || data?.data?.token || data?.data?.accessToken || null;
}

function findField(data, name) {
  if (data && typeof data === 'object' && !Array.isArray(data) && name in data) return data[name];
  for (const key of ['task', 'data', 'item', 'user', 'result', 'todo']) {
    const nested = data?.[key];
    if (nested && typeof nested === 'object' && name in nested) return nested[name];
  }
  return undefined;
}

function substitute(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

function isValidCase(c) {
  return Boolean(
    c &&
      typeof c.path === 'string' &&
      c.path.startsWith('/') &&
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(c.method || 'GET').toUpperCase())
  );
}

function missingVar(path, vars) {
  const matches = path.match(/\{(\w+)\}/g) || [];
  return matches.find((m) => !(m.slice(1, -1) in vars)) || null;
}

async function runGeneratedTests(plan, baseUrl, orchestrator) {
  const cases = (Array.isArray(plan?.cases) ? plan.cases : []).filter(isValidCase);
  const tests = cases.map((c) => ({ name: c.name || `${c.method} ${c.path}`, passed: false, error: null }));
  const vars = {};

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    const t = tests[i];
    const missing = missingVar(c.path, vars);
    if (missing) {
      t.error = `Ignorado: variável ${missing} ausente (etapa anterior falhou ou não capturou o valor).`;
      continue;
    }

    try {
      const url = `${baseUrl}${substitute(c.path, vars)}`;
      const headers = {};
      let body;
      if (c.body !== undefined && c.body !== null) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(c.body);
      }
      if (c.auth && vars.authToken) headers.Authorization = `Bearer ${vars.authToken}`;

      orchestrator.log('qa', `Executando teste: ${t.name}...`, 'info');
      const res = await fetch(url, {
        method: String(c.method || 'GET').toUpperCase(),
        headers,
        body,
        signal: AbortSignal.timeout(15000)
      });
      const data = res.status === 204 ? null : await res.json().catch(() => null);

      const statusOk = matchesStatus(res.status, c.expectedStatus);
      let bodyOk = true;
      let captured;

      if (c.expect === 'list') {
        bodyOk = pickList(data) !== null;
      } else if (c.expect === 'object-id') {
        const obj = pickObjectWithId(data);
        bodyOk = Boolean(obj);
        if (obj) captured = obj.id;
      } else if (c.expect === 'token') {
        captured = pickToken(data);
        bodyOk = Boolean(captured);
      } else if (typeof c.expect === 'string' && c.expect.startsWith('field:')) {
        const [fieldName, expectedRaw] = c.expect.slice('field:'.length).split('=');
        const actual = findField(data, fieldName);
        const expectedVal = expectedRaw === 'true' ? true : expectedRaw === 'false' ? false : expectedRaw;
        bodyOk = actual === expectedVal;
      }
      // 'none' (ou valor não reconhecido): só o status importa.

      if (statusOk && bodyOk) {
        t.passed = true;
        if (c.captureAs && captured !== undefined) {
          vars[c.captureAs] = captured;
          if (c.expect === 'token') vars.authToken = captured;
        }
      } else {
        t.error = `Esperado status ${c.expectedStatus ?? 'qualquer'} / expect=${c.expect ?? 'none'}. Status obtido: ${res.status}, Resposta: ${JSON.stringify(data)}`;
      }
    } catch (err) {
      t.error = err.message;
    }
  }

  return { passed: tests.length > 0 && tests.every((t) => t.passed), tests };
}

module.exports = {
  runGeneratedTests,
  isValidCase,
  __test__: { matchesStatus, pickList, pickObjectWithId, pickToken, findField, substitute }
};
