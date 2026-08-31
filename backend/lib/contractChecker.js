const path = require('path');
const { getPlanTestCases } = require('./architectPlan');

const ROUTE_RE = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;

function normalizeRoutePath(routePath) {
  return String(routePath)
    .trim()
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/:\w+/g, ':param');
}

function extractRoutesFromFiles(files) {
  const routes = new Set();
  for (const file of files || []) {
    const content = String(file?.content || '');
    if (!content) continue;
    let match;
    const re = new RegExp(ROUTE_RE.source, ROUTE_RE.flags);
    while ((match = re.exec(content))) {
      routes.add(`${String(match[1]).toUpperCase()} ${match[2]}`);
    }
  }
  return routes;
}

function resolveImportPath(fromFile, importPath) {
  const base = path.posix.dirname(String(fromFile).replace(/\\/g, '/'));
  let resolved = path.posix.normalize(path.posix.join(base, importPath));
  if (!resolved.startsWith('.')) return resolved.replace(/^\.\//, '');
  return resolved.replace(/^\.\//, '');
}

function checkImports(files) {
  const pathSet = new Set((files || []).map((f) => f.path));
  const missing = [];
  const importRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)|from\s+['"](\.[^'"]+)['"]/g;

  for (const file of files || []) {
    const content = String(file.content || '');
    let match;
    while ((match = importRe.exec(content))) {
      const rel = match[1] || match[2];
      const candidates = [
        resolveImportPath(file.path, rel),
        `${resolveImportPath(file.path, rel)}.js`,
        `${resolveImportPath(file.path, rel)}.ts`,
        `${resolveImportPath(file.path, rel)}/index.js`
      ];
      if (!candidates.some((c) => pathSet.has(c))) {
        missing.push({ file: file.path, import: rel });
      }
    }
  }
  return { passed: missing.length === 0, missing };
}

/**
 * Verifica se rotas declaradas no código cobrem contratos/cenários do plano (determinístico, sem LLM).
 */
function checkPlanContractAlignment(files, plan) {
  const routes = extractRoutesFromFiles(files);
  const normalizedFound = new Set(
    [...routes].map((r) => {
      const space = r.indexOf(' ');
      return `${r.slice(0, space)} ${normalizeRoutePath(r.slice(space + 1))}`;
    })
  );

  const expected = [];
  for (const contract of plan?.apiContracts || []) {
    if (contract?.method && contract?.path) {
      expected.push({ method: contract.method, path: contract.path, source: 'contract' });
    }
  }
  for (const scenario of getPlanTestCases(plan)) {
    expected.push({ method: scenario.method, path: scenario.path, source: 'scenario' });
  }

  const missing = [];
  const seen = new Set();
  for (const item of expected) {
    const key = `${item.method.toUpperCase()} ${normalizeRoutePath(item.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (normalizedFound.has(key)) continue;
    if (item.path === '/health' || item.path === '/api/health') continue;
    missing.push(`${item.method.toUpperCase()} ${item.path} (${item.source})`);
  }

  return {
    passed: missing.length === 0,
    missing,
    found: [...routes]
  };
}

module.exports = {
  extractRoutesFromFiles,
  checkPlanContractAlignment,
  checkImports,
  normalizeRoutePath
};
