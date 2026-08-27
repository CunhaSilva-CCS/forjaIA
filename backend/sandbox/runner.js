const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Docker = require('dockerode');
const config = require('../lib/config');
const dockerBuild = require('../lib/dockerBuild');

const needsCompile = dockerBuild.needsCompile;

/** Cadeia comum (dockerBuild) + fallbacks específicos de sandbox: src/index.ts (tsx) e um
 * palpite final incondicional (node server.js), já que a sandbox sempre precisa de "algo"
 * para subir — se estiver errado, o waitForHttp abaixo vai só dar timeout, não travar o fluxo. */
function detectStartCommand(sandboxPath) {
  const found = dockerBuild.detectStartCommand(sandboxPath);
  if (found) return found;
  if (fs.existsSync(path.join(sandboxPath, 'src/index.ts'))) {
    return { cmd: 'npx', args: ['tsx', 'src/index.ts'] };
  }
  return { cmd: 'node', args: ['server.js'] };
}

// Sempre gerar Dockerfile da forja: Dockerfiles do projeto costumam expor
// outra porta (ex.: 5000/5100) e CMD errado — QA então vê "fetch failed".
function buildDockerfile(sandboxPath, start) {
  return dockerBuild.buildDockerfile(sandboxPath, start, { containerPort: 3000, nodeEnv: 'test' });
}

async function waitForHttp(baseUrl, { attempts = 20, delayMs = 1000, orchestrator, onTick } = {}) {
  let lastErr = null;
  const probes = ['/health', '/api/health', '/'];
  for (let i = 1; i <= attempts; i += 1) {
    if (onTick) {
      const early = await onTick(i);
      if (early) throw early;
    }
    for (const probe of probes) {
      try {
        const res = await fetch(`${baseUrl}${probe === '/' ? '' : probe}`, {
          signal: AbortSignal.timeout(2000)
        });
        // Aceita 2xx/3xx/4xx (app no ar). Só 5xx conta como ainda não pronto.
        if (res.status < 500) return true;
        lastErr = new Error(`HTTP ${res.status} em ${probe}`);
      } catch (err) {
        lastErr = err;
      }
    }
    orchestrator?.log?.(
      'devops',
      `Aguardando sandbox ficar pronta (${i}/${attempts})…`,
      'info'
    );
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Sandbox não respondeu em ${baseUrl} (${lastErr?.message || 'timeout'})`
  );
}

function normalizeSandboxEnvFile(sandboxPath, port) {
  const envPath = path.join(sandboxPath, '.env');
  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    : [];
  const map = new Map();
  for (const line of lines) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    map.set(line.slice(0, i).trim(), line.slice(i + 1));
  }
  map.set('PORT', String(port));
  map.set('HOST', '0.0.0.0');
  if (!map.has('NODE_ENV')) map.set('NODE_ENV', 'test');
  if (!map.has('EMBEDDING_PROVIDER')) map.set('EMBEDDING_PROVIDER', 'local');
  if (!map.has('JWT_SECRET')) map.set('JWT_SECRET', 'sandbox_only_secret_forjaia_32chars_min');
  if (String(map.get('JWT_SECRET') || '').length < 32) {
    map.set('JWT_SECRET', 'sandbox_only_secret_forjaia_32chars_min');
  }
  const body = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(envPath, body, 'utf8');
}

async function readContainerTail(container, max = 4000) {
  if (!container) return '';
  try {
    const buf = await container.logs({ stdout: true, stderr: true, tail: 80 });
    return String(buf || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .slice(-max);
  } catch {
    return '';
  }
}

class SandboxRunner {
  constructor() {
    this.docker = null;
    this.container = null;
    this.childProcess = null;
    this.sandboxPath = path.join(__dirname, '../tmp-sandbox');
    this.hostPort = config.sandboxHostPort;

    try {
      this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    } catch {
      this.docker = null;
    }
  }

  async verifyDocker() {
    if (!this.docker) {
      try {
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
      } catch {
        return false;
      }
    }
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async freeHostPort() {
    try {
      execSync(
        `docker ps -aq --filter publish=${this.hostPort} | xargs -r docker rm -f`,
        { stdio: 'ignore' }
      );
    } catch {
      // xargs -r is GNU; on macOS use alternate
      try {
        const ids = execSync(`docker ps -aq --filter publish=${this.hostPort}`, {
          encoding: 'utf8'
        })
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        for (const id of ids) {
          try {
            execSync(`docker rm -f ${id}`, { stdio: 'ignore' });
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }
  }

  async start(files, orchestrator) {
    orchestrator?.throwIfAborted?.();
    orchestrator.log('devops', 'Preparando área da sandbox...', 'info');

    if (fs.existsSync(this.sandboxPath)) {
      fs.rmSync(this.sandboxPath, { recursive: true, force: true });
    }
    fs.mkdirSync(this.sandboxPath, { recursive: true });

    const sandboxRoot = path.resolve(this.sandboxPath);
    for (const file of files) {
      if (!file?.path) continue;
      const fullPath = path.resolve(sandboxRoot, file.path);
      const rel = path.relative(sandboxRoot, fullPath);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Caminho de arquivo inválido na sandbox: ${file.path}`);
      }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content || '', 'utf8');
    }

    const pkgPath = path.join(this.sandboxPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      fs.writeFileSync(
        pkgPath,
        JSON.stringify(
          {
            name: 'forja-sandbox',
            version: '1.0.0',
            main: 'server.js',
            dependencies: { express: '^4.19.2' }
          },
          null,
          2
        )
      );
    }

    const start = detectStartCommand(this.sandboxPath);
    normalizeSandboxEnvFile(this.sandboxPath, 3000);
    // Evita que o Dockerfile do projeto (porta/CMD diferentes) quebre o mapeamento 3000→host
    try {
      fs.unlinkSync(path.join(this.sandboxPath, 'Dockerfile'));
    } catch {
      // ignore
    }

    const hasDocker = await this.verifyDocker();

    // Com FORJA_REQUIRE_DOCKER=false, preferir processo local (evita builds longos
    // e reinícios do nodemon enquanto a validação corre).
    if (!config.requireDocker) {
      if (!hasDocker) {
        orchestrator.log('devops', 'Docker indisponível; usando sandbox local.', 'info');
      } else {
        orchestrator.log('devops', 'Docker opcional: usando sandbox local (mais estável).', 'info');
      }
      return this.startChildProcess(orchestrator, start);
    }

    if (!hasDocker) {
      throw new Error('Docker é obrigatório, mas não está disponível. Inicie o Docker Desktop / daemon.');
    }

    orchestrator.log('devops', 'Construindo sandbox Docker isolada...', 'info');
    try {
      await this.freeHostPort();
      const dockerfileContent = buildDockerfile(this.sandboxPath, start);
      fs.writeFileSync(path.join(this.sandboxPath, 'Dockerfile'), dockerfileContent, 'utf8');
      if (!fs.existsSync(path.join(this.sandboxPath, '.dockerignore'))) {
        fs.writeFileSync(
          path.join(this.sandboxPath, '.dockerignore'),
          'node_modules\n.git\n*.db\n*.db-*\ncoverage\n',
          'utf8'
        );
      }

      if (needsCompile(this.sandboxPath, start)) {
        orchestrator.log('devops', 'Sandbox TypeScript detectada — build na imagem.', 'info');
      }

      try {
        execSync('docker build -t forja-temp-sandbox .', {
          cwd: this.sandboxPath,
          stdio: 'pipe',
          encoding: 'utf8'
        });
      } catch (buildErr) {
        const detail = String(buildErr.stderr || buildErr.stdout || buildErr.message || '').slice(-1500);
        throw new Error(`docker build falhou: ${detail || buildErr.message}`);
      }

      this.container = await this.docker.createContainer({
        Image: 'forja-temp-sandbox',
        ExposedPorts: { '3000/tcp': {} },
        HostConfig: {
          PortBindings: {
            '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(this.hostPort) }]
          },
          Memory: 768 * 1024 * 1024,
          NanoCpus: 2e9,
          NetworkMode: 'bridge'
        },
        Env: [
          'PORT=3000',
          'HOST=0.0.0.0',
          'NODE_ENV=test',
          'JWT_SECRET=sandbox_only_secret_forjaia_32chars_min',
          'EMBEDDING_PROVIDER=local',
          'DB_PATH=./data/rag.db'
        ]
      });

      await this.container.start();
      const baseUrl = `http://127.0.0.1:${this.hostPort}`;
      orchestrator.log('devops', `Sandbox Docker mapeada em ${baseUrl}`, 'success');
      await waitForHttp(baseUrl, {
        attempts: 40,
        delayMs: 1500,
        orchestrator,
        onTick: async () => {
          try {
            const info = await this.container.inspect();
            if (!info.State?.Running) {
              const logs = await readContainerTail(this.container);
              return new Error(
                `Container da sandbox saiu (exit ${info.State?.ExitCode ?? '?'}). Logs:\n${logs || '(vazio)'}`
              );
            }
          } catch {
            // ignore inspect errors during boot
          }
          return null;
        }
      });
      orchestrator?.throwIfAborted?.();

      return {
        type: 'docker',
        baseUrl,
        port: this.hostPort,
        containerId: this.container.id,
        runner: this
      };
    } catch (err) {
      const logs = await readContainerTail(this.container);
      if (this.container) {
        try {
          await this.container.stop();
        } catch {}
        try {
          await this.container.remove({ force: true });
        } catch {}
        this.container = null;
      }
      const msg = logs ? `${err.message}\n--- logs ---\n${logs}` : err.message;
      if (config.requireDocker) {
        throw new Error(`Falha na sandbox Docker: ${msg}`);
      }
      orchestrator.log('devops', `Falha no Docker (${err.message}); usando processo local.`, 'warning');
      return this.startChildProcess(orchestrator, start);
    }
  }

  startChildProcess(orchestrator, start) {
    const cmd = start || detectStartCommand(this.sandboxPath);
    normalizeSandboxEnvFile(this.sandboxPath, this.hostPort);
    orchestrator.log('devops', 'Iniciando sandbox local em subprocesso Node...', 'info');
    const compile = needsCompile(this.sandboxPath, cmd);
    try {
      execSync(compile ? 'npm install' : 'npm install --omit=dev', {
        cwd: this.sandboxPath,
        stdio: 'ignore'
      });
    } catch {
      try {
        execSync('npm install', { cwd: this.sandboxPath, stdio: 'ignore' });
      } catch {
        orchestrator.log('devops', 'Aviso do npm install na sandbox local', 'warning');
      }
    }
    if (compile) {
      try {
        execSync('npm run build', { cwd: this.sandboxPath, stdio: 'ignore' });
      } catch {
        try {
          execSync('npx tsc', { cwd: this.sandboxPath, stdio: 'ignore' });
        } catch (e) {
          orchestrator.log('devops', `Build local da sandbox falhou: ${e.message}`, 'warning');
        }
      }
    }

    return new Promise((resolve, reject) => {
      try {
        this.childProcess = spawn(cmd.cmd, cmd.args, {
          cwd: this.sandboxPath,
          env: {
            ...process.env,
            PATH: process.env.PATH,
            PORT: String(this.hostPort),
            HOST: '127.0.0.1',
            NODE_ENV: 'test',
            JWT_SECRET: 'sandbox_only_secret_forjaia_32chars_min',
            EMBEDDING_PROVIDER: 'local',
            DB_PATH: './data/rag.db'
          }
        });

        this.childProcess.stdout.on('data', (data) => console.log(`[SANDBOX] ${data}`));
        this.childProcess.stderr.on('data', (data) => console.error(`[SANDBOX] ${data}`));

        const baseUrl = `http://127.0.0.1:${this.hostPort}`;
        waitForHttp(baseUrl, { attempts: 30, delayMs: 500, orchestrator })
          .then(() =>
            resolve({
              type: 'child_process',
              baseUrl,
              port: this.hostPort,
              runner: this
            })
          )
          .catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  async stop(orchestrator) {
    if (this.container) {
      orchestrator?.log?.('devops', 'Parando sandbox Docker...', 'info');
      try {
        await this.container.stop({ t: 2 });
      } catch {}
      try {
        await this.container.remove({ force: true });
      } catch {}
      this.container = null;
    }

    if (this.childProcess) {
      try {
        this.childProcess.kill('SIGTERM');
      } catch {}
      this.childProcess = null;
    }

    try {
      if (fs.existsSync(this.sandboxPath)) {
        fs.rmSync(this.sandboxPath, { recursive: true, force: true });
      }
    } catch {}
  }
}

module.exports = new SandboxRunner();
