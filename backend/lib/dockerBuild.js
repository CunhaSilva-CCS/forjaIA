const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Peças compartilhadas entre sandbox/runner.js (QA/Security) e lib/deployRuntime.js
 * (deploy final): detecção de entrypoint, detecção de necessidade de build/compile
 * nativo, e geração do Dockerfile. Cada chamador mantém sua própria lógica de
 * waitForHttp/health-check — são filosofias deliberadamente diferentes (sandbox
 * aceita qualquer resposta <500 de vários probes; deploy exige 2xx estrito em
 * /api/health ou /health e monitora liveness do container).
 */

function readPackageJson(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
}

/** Cadeia comum: package.json start/main → src/server.js → server.js. Retorna null se nada encontrado. */
function detectStartCommand(dir) {
  const pkg = readPackageJson(dir);
  if (pkg) {
    if (pkg.scripts?.start) {
      const parts = String(pkg.scripts.start).trim().split(/\s+/);
      if (parts[0] === 'node' && parts[1]) return { cmd: 'node', args: parts.slice(1) };
      return { cmd: 'npm', args: ['start'] };
    }
    if (pkg.main) return { cmd: 'node', args: [pkg.main] };
  }
  if (fs.existsSync(path.join(dir, 'src/server.js'))) {
    return { cmd: 'node', args: ['src/server.js'] };
  }
  if (fs.existsSync(path.join(dir, 'server.js'))) {
    return { cmd: 'node', args: ['server.js'] };
  }
  return null;
}

function needsCompile(dir, start) {
  const pkg = readPackageJson(dir) || {};
  if (pkg.scripts?.build) return true;
  if (fs.existsSync(path.join(dir, 'tsconfig.json'))) return true;
  const entry = start?.args?.[0] || '';
  if (String(entry).startsWith('dist/') || String(entry).endsWith('.ts')) return true;
  if (String(pkg.main || '').startsWith('dist/')) return true;
  return false;
}

function needsNativeBuild(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  return /better-sqlite3|sharp|bcrypt(?!js)|node-gyp/.test(fs.readFileSync(pkgPath, 'utf8'));
}

function buildDockerfile(dir, start, { containerPort = 3000, nodeEnv = 'test' } = {}) {
  const cmdJson = JSON.stringify([start.cmd, ...start.args]);
  const compile = needsCompile(dir, start);
  const native = needsNativeBuild(dir);

  const nativeDeps = native
    ? 'RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \\\n'
      + '  && rm -rf /var/lib/apt/lists/*\n'
    : '';
  const install = compile ? 'RUN npm install' : 'RUN npm install --omit=dev';
  const buildStep = compile ? 'RUN npm run build || (test -f tsconfig.json && npx tsc)\n' : '';

  return `FROM node:20-slim
WORKDIR /app
${nativeDeps}COPY package.json package-lock.json* ./
${install}
COPY . .
${buildStep}ENV NODE_ENV=${nodeEnv}
ENV PORT=${containerPort}
ENV HOST=0.0.0.0
EXPOSE ${containerPort}
CMD ${cmdJson}
`;
}

/**
 * Substituto assíncrono de execSync (ver ADR-006) — `docker build`/`npm install` reais
 * podem levar dezenas de segundos a minutos; execSync bloqueia o event loop inteiro
 * durante esse tempo, impedindo o control plane de responder a QUALQUER requisição.
 * Roda via shell (mesmo comportamento de execSync: aceita string com pipes/redirects).
 */
function execAsync(cmd, { cwd, ignoreOutput = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { cwd, shell: true });
    let stdout = '';
    let stderr = '';
    if (!ignoreOutput) {
      child.stdout?.on('data', (d) => {
        stdout += d;
      });
      child.stderr?.on('data', (d) => {
        stderr += d;
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const err = new Error(`Comando falhou (código ${code}): ${cmd}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

module.exports = {
  readPackageJson,
  detectStartCommand,
  needsCompile,
  needsNativeBuild,
  buildDockerfile,
  execAsync
};
