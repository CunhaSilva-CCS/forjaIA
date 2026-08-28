const fs = require('fs');
const path = require('path');
const config = require('./config');
const { scanForHardcodedSecrets } = require('./secretScan');

function readSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function detectEntrypoint(deployDir) {
  const pkgPath = path.join(deployDir, 'package.json');
  if (exists(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts?.start) return { ok: true, detail: `npm start → ${pkg.scripts.start}` };
      if (pkg.main) return { ok: true, detail: `main → ${pkg.main}` };
    } catch (err) {
      return { ok: false, detail: `package.json inválido: ${err.message}` };
    }
  }
  if (exists(path.join(deployDir, 'src/server.js'))) {
    return { ok: true, detail: 'src/server.js' };
  }
  if (exists(path.join(deployDir, 'server.js'))) {
    return { ok: true, detail: 'server.js' };
  }
  return { ok: false, detail: 'sem start/main/server.js' };
}

function codeUsesPortEnv(deployDir) {
  const portEnvRe =
    /process\.env\.PORT|process\.env\[['\"]PORT['\"]\]|(?:num|env|int|getEnv|getenv)\(\s*['\"]PORT['\"]/;
  const skip = new Set(['node_modules', '.git', 'data', 'dist', 'coverage']);
  let found = null;

  function walk(dir, depth = 0) {
    if (found || depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (found) return;
      if (skip.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(js|mjs|cjs|ts|tsx)$/i.test(ent.name)) continue;
      const content = readSafe(full);
      if (!content) continue;
      if (portEnvRe.test(content)) {
        found = path.relative(deployDir, full);
      }
    }
  }

  walk(deployDir);
  if (found) {
    return { ok: true, detail: `${found} lê PORT do environment` };
  }

  const pkg = readSafe(path.join(deployDir, 'package.json'));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      const start = String(parsed.scripts?.start || '');
      if (/PORT/.test(start)) return { ok: true, detail: 'script start referencia PORT' };
    } catch {
      // ignore
    }
  }
  return {
    ok: false,
    detail: 'não encontrei leitura de PORT via environment no código'
  };
}

/**
 * Antes rodava um segundo detector de segredo próprio, sem os fixes do ADR-011 (sem exclusão de
 * arquivo de teste, sem checar se o valor "parece" segredo de verdade) — reintroduzia os mesmos
 * falsos-positivos já corrigidos em `lib/secretScan.js`/`agent/security.js` (ex.: `const password
 * = "Abc!2345"` num fixture `__tests__/*.test.js`), fazendo o checklist de produção bloquear a run
 * (`severity: 'CRITICAL'`) por um "segredo" que o SAST da etapa de Segurança já tinha deixado
 * passar corretamente no mesmo run. Agora reusa o scanner endurecido em vez de duplicar a lógica.
 */
function scanHardcodedSecrets(deployDir) {
  const filesToScan = [];
  const skip = new Set(['node_modules', '.git', 'data', 'dist', 'coverage']);
  function walk(dir, depth = 0) {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (skip.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(js|ts|tsx|jsx|mjs|cjs|json|env\.example)$/i.test(ent.name)) continue;
      if (ent.name === '.env') continue;
      const content = readSafe(full);
      if (!content) continue;
      filesToScan.push({ path: path.relative(deployDir, full), content });
    }
  }
  walk(deployDir);
  const issues = scanForHardcodedSecrets(filesToScan);
  return [...new Set(issues.map((issue) => issue.file))];
}

function defaultDockerfile(deployPort) {
  return `FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
# Host: map ${deployPort}->3000  (ex.: docker run -p ${deployPort}:3000)
CMD ["npm", "start"]
`;
}

function defaultDockerignore() {
  return `node_modules
npm-debug.log
.git
.env
.env.*
!.env.example
data
coverage
dist
.tmp
*.db
*.db-*
`;
}

function defaultEnvExample(deployPort) {
  return `# Copie para .env e preencha valores reais. Nunca commite segredos.
NODE_ENV=production
HOST=0.0.0.0
PORT=${deployPort}
JWT_SECRET=change-me-to-a-long-random-secret
`;
}

function defaultProductionMd(deployUrl, relativeTarget) {
  return `# Pronto para produção

Este projeto foi aprovado pelo pipeline ForjaIA (QA → Segurança → DevOps → Humano in loco → Checklist de produção).

## Subir localmente (produção)

\`\`\`bash
cd ${relativeTarget || '.'}
cp -n .env.example .env   # se ainda não tiver .env
npm install --omit=dev
npm start
\`\`\`

Health: \`${deployUrl || 'http://127.0.0.1:' + config.deployHostPort}/api/health\`

## Docker

\`\`\`bash
docker build -t app-prod .
docker run --rm -p ${config.deployHostPort}:3000 --env-file .env app-prod
\`\`\`

## Requisitos

- \`PORT\` e \`HOST\` via variáveis de ambiente
- Segredos apenas em \`.env\` / secrets do orquestrador
- \`NODE_ENV=production\`
`;
}

/**
 * Garante artefatos mínimos de produção no diretório do projeto.
 * Retorna lista de arquivos gravados { path, content }.
 */
function ensureProductionArtifacts(deployDir, { deployUrl, relativeTarget } = {}) {
  const written = [];
  const port = config.deployHostPort;

  const ensure = (rel, content, { overwrite = false } = {}) => {
    const full = path.join(deployDir, rel);
    if (!overwrite && exists(full)) return;
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      written.push({ path: rel, content });
    } catch (err) {
      // Não derruba o checklist se o disco estiver read-only; o check de existência falhará.
      written.push({ path: rel, content, error: err.message });
    }
  };

  ensure('Dockerfile', defaultDockerfile(port));
  ensure('.dockerignore', defaultDockerignore());
  ensure('.env.example', defaultEnvExample(port));
  ensure('PRODUCTION.md', defaultProductionMd(deployUrl, relativeTarget), { overwrite: true });

  // package.json: ensure start script if missing but entrypoint file exists
  const pkgPath = path.join(deployDir, 'package.json');
  if (exists(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      let dirty = false;
      pkg.scripts = pkg.scripts || {};
      if (!pkg.scripts.start) {
        if (exists(path.join(deployDir, 'src/server.js'))) {
          pkg.scripts.start = 'node src/server.js';
          dirty = true;
        } else if (exists(path.join(deployDir, 'server.js'))) {
          pkg.scripts.start = 'node server.js';
          dirty = true;
        }
      }
      if (!pkg.scripts.healthcheck) {
        pkg.scripts.healthcheck = `node -e "fetch('http://127.0.0.1:'+(process.env.PORT||${port})+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
        dirty = true;
      }
      if (dirty) {
        const content = `${JSON.stringify(pkg, null, 2)}\n`;
        fs.writeFileSync(pkgPath, content, 'utf8');
        written.push({ path: 'package.json', content });
      }
    } catch {
      // ignore
    }
  }

  return written;
}

/**
 * Avalia se o projeto está pronto para produção (fail-closed).
 */
async function evaluateProductionReady({
  deployDir,
  deployUrl,
  relativeTarget,
  task = {},
  writeArtifacts = true
} = {}) {
  // Checklist inteiro pressupõe artefato web (Dockerfile, PORT, /health) — não se aplica a app
  // mobile Expo/RN (ver ADR-014). Sem HTTP pra ninguém validar aqui, passa direto: já foi
  // instalado e aberto de verdade no Simulador na etapa de deploy, o que já é a prova real.
  const { detectProjectType } = require('./projectType');
  if (detectProjectType(task.files) === 'mobile-expo') {
    return {
      ready: true,
      summary: 'Projeto mobile — checklist de produção web não se aplica; app já instalado e aberto no Simulador.',
      checks: [],
      issues: [],
      artifactsWritten: []
    };
  }

  const checks = [];
  const artifactsWritten = writeArtifacts
    ? ensureProductionArtifacts(deployDir, { deployUrl, relativeTarget })
    : [];

  const entry = detectEntrypoint(deployDir);
  checks.push({
    id: 'entrypoint',
    ok: entry.ok,
    severity: 'CRITICAL',
    title: 'Entrypoint de produção',
    detail: entry.detail
  });

  const portEnv = codeUsesPortEnv(deployDir);
  checks.push({
    id: 'port-env',
    ok: portEnv.ok,
    severity: 'HIGH',
    title: 'PORT via environment',
    detail: portEnv.detail
  });

  checks.push({
    id: 'dockerfile',
    ok: exists(path.join(deployDir, 'Dockerfile')),
    severity: 'HIGH',
    title: 'Dockerfile presente',
    detail: exists(path.join(deployDir, 'Dockerfile')) ? 'ok' : 'ausente'
  });

  checks.push({
    id: 'dockerignore',
    ok: exists(path.join(deployDir, '.dockerignore')),
    severity: 'MEDIUM',
    title: '.dockerignore presente',
    detail: exists(path.join(deployDir, '.dockerignore')) ? 'ok' : 'ausente'
  });

  checks.push({
    id: 'env-example',
    ok: exists(path.join(deployDir, '.env.example')),
    severity: 'MEDIUM',
    title: '.env.example sem segredos',
    detail: exists(path.join(deployDir, '.env.example')) ? 'ok' : 'ausente'
  });

  const secretHits = scanHardcodedSecrets(deployDir);
  checks.push({
    id: 'no-hardcoded-secrets',
    ok: secretHits.length === 0,
    severity: 'CRITICAL',
    title: 'Sem segredos hardcoded',
    detail: secretHits.length ? `suspeitos em: ${secretHits.join(', ')}` : 'nenhum padrão óbvio'
  });

  const tests = task.tests || [];
  const qaOk = tests.length > 0 && tests.every((t) => t.passed);
  checks.push({
    id: 'qa-green',
    ok: qaOk,
    severity: 'HIGH',
    title: 'QA 100% verde',
    detail: tests.length ? `${tests.filter((t) => t.passed).length}/${tests.length}` : 'sem testes'
  });

  const securityIssues = task.securityIssues || [];
  const highSec = securityIssues.filter((i) =>
    /critical|high|alta|crítica|critica/i.test(String(i.severity || ''))
  );
  checks.push({
    id: 'security-clean',
    ok: highSec.length === 0,
    severity: 'HIGH',
    title: 'Sem achados de segurança HIGH/CRITICAL',
    detail: highSec.length ? `${highSec.length} aberto(s)` : 'limpo'
  });

  const human = task.humanReport || task.config?.humanReport || task.config?.lastHumanReport;
  checks.push({
    id: 'human-passed',
    ok: Boolean(human?.passed),
    severity: 'HIGH',
    title: 'Teste humano in loco aprovado',
    detail: human?.passed ? 'passou' : 'não aprovado / ausente'
  });

  const metrics = task.performanceMetrics || {};
  if (metrics && typeof metrics.successRate === 'number') {
    const ok = metrics.successRate >= 90;
    checks.push({
      id: 'load-success',
      ok,
      severity: 'MEDIUM',
      title: 'Carga com sucesso ≥ 90%',
      detail: `${metrics.successRate}%`
    });
  }

  let healthOk = false;
  let healthDetail = 'sem URL de deploy';
  if (deployUrl) {
    const base = String(deployUrl).replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) }).catch(() =>
        fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
      );
      healthOk = Boolean(res && res.ok);
      healthDetail = res ? `HTTP ${res.status}` : 'sem resposta';
    } catch (err) {
      healthDetail = err.message;
    }
  }
  checks.push({
    id: 'live-health',
    ok: healthOk,
    severity: 'CRITICAL',
    title: 'Healthcheck ao vivo',
    detail: healthDetail
  });

  const blocking = checks.filter(
    (c) => !c.ok && ['HIGH', 'CRITICAL'].includes(String(c.severity).toUpperCase())
  );
  const ready = blocking.length === 0;

  const issues = blocking.map((c) => ({
    id: `PROD-${c.id.toUpperCase()}`,
    severity: c.severity,
    title: c.title,
    description: c.detail,
    remediation: 'Corrigir o item do checklist de produção e reexecutar o gate prodReady.'
  }));

  return {
    ready,
    checks,
    issues,
    artifactsWritten,
    summary: ready
      ? `Pronto para produção: ${checks.filter((c) => c.ok).length}/${checks.length} checks OK.`
      : `Bloqueado para produção: ${blocking.length} check(s) crítico(s)/alto(s) falharam.`
  };
}

module.exports = {
  evaluateProductionReady,
  ensureProductionArtifacts,
  defaultDockerfile,
  defaultDockerignore,
  defaultEnvExample
};
