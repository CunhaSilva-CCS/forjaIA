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

function usesTsRuntime(pkg) {
  return /\btsx\b|\bts-node\b/.test(String(pkg?.scripts?.start || ''));
}

function needsCompile(dir, start) {
  const pkg = readPackageJson(dir) || {};
  // Achado real (ver ADR-037): se o start já executa TypeScript direto via tsx/ts-node, o
  // runtime não depende de dist/ nenhum — forçar um `tsc`/`npm run build` aqui é trabalho
  // desnecessário e, pior, um projeto assim frequentemente não tem tsconfig.json de verdade
  // (nunca precisou de um pra rodar), o que faz o build falhar por um motivo que não afeta a
  // aplicação em nada.
  if (usesTsRuntime(pkg)) return false;
  if (pkg.scripts?.build) return true;
  if (fs.existsSync(path.join(dir, 'tsconfig.json'))) return true;
  const entry = start?.args?.[0] || '';
  if (String(entry).startsWith('dist/') || String(entry).endsWith('.ts')) return true;
  if (String(pkg.main || '').startsWith('dist/')) return true;
  return false;
}

/** Achado real (regressão própria do fix acima, pego na MESMA verificação ao vivo): "precisa
 * compilar" e "precisa de devDependencies instaladas" não são a mesma pergunta. Um projeto tsx/
 * ts-node não compila nada, mas o próprio `tsx`/`ts-node` é uma devDependency — sem instalar dev
 * deps o container sobe e morre na hora com "sh: 1: tsx: not found" (exit 127). */
function needsDevDependencies(dir, start) {
  return needsCompile(dir, start) || usesTsRuntime(readPackageJson(dir));
}

/** tsconfig.json padrão pra quando o projeto genuinamente precisa compilar (start roda dist/*.js
 * via `node`, não tsx/ts-node) mas o Codificador não escreveu um — sem isso, `tsc` sem config nem
 * arquivo de entrada não dá erro de compilação, imprime a AJUDA de linha de comando e sai com
 * código 1 (achado real, ver ADR-037), travando o build da sandbox pra sempre sem nenhum caminho
 * de correção automática. */
function defaultTsconfig(pkg) {
  const isEsm = pkg?.type === 'module';
  return {
    compilerOptions: {
      target: 'ES2020',
      module: isEsm ? 'NodeNext' : 'commonjs',
      moduleResolution: isEsm ? 'NodeNext' : 'node',
      outDir: 'dist',
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false,
      resolveJsonModule: true
    },
    include: ['**/*.ts'],
    exclude: ['node_modules', 'dist']
  };
}

function ensureTsconfig(dir) {
  const tsconfigPath = path.join(dir, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) return false;
  fs.writeFileSync(tsconfigPath, JSON.stringify(defaultTsconfig(readPackageJson(dir)), null, 2), 'utf8');
  return true;
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

  if (compile) ensureTsconfig(dir);

  const nativeDeps = native
    ? 'RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \\\n'
      + '  && rm -rf /var/lib/apt/lists/*\n'
    : '';
  const install = needsDevDependencies(dir, start) ? 'RUN npm install' : 'RUN npm install --omit=dev';
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
    // Auditado (ver ADR-021/pente fino ADR-019): este É o ponto que roda comando com shell de
    // verdade — cada chamador foi revisado individualmente (mobileDeploy.js sanitiza nome de
    // workspace/scheme antes de interpolar; windowsDeploy.js só usa constante + id numérico;
    // deployRuntime.js coage hostPort pra Number antes de interpolar). QUALQUER chamador NOVO
    // de execAsync precisa da mesma revisão antes de interpolar dado externo na string de `cmd`.
    const child = spawn(cmd, { cwd, shell: true }); // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
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
  needsDevDependencies,
  needsNativeBuild,
  buildDockerfile,
  ensureTsconfig,
  defaultTsconfig,
  execAsync
};
