const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Docker = require('dockerode');
const config = require('./config');
const dockerBuild = require('./dockerBuild');

const IMAGE_TAG = 'forja-prod-deploy';
const CONTAINER_PORT = 3000;

let active = {
  type: null,
  container: null,
  childProcess: null,
  docker: null
};

const detectStartCommand = dockerBuild.detectStartCommand;

function buildProdDockerfile(deployDir, start) {
  return dockerBuild.buildDockerfile(deployDir, start, {
    containerPort: CONTAINER_PORT,
    nodeEnv: 'production'
  });
}

async function waitForHttp(baseUrl, { attempts = 30, delayMs = 1200, orchestrator, container } = {}) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i += 1) {
    if (container) {
      try {
        const info = await container.inspect();
        if (!info?.State?.Running) {
          let logs = '';
          try {
            const buf = await container.logs({ stdout: true, stderr: true, tail: 40 });
            logs = String(buf || '').slice(-1500);
          } catch {
            // ignore
          }
          throw new Error(
            `Container de deploy saiu antes de ficar saudável${logs ? `: ${logs}` : ''}`
          );
        }
      } catch (err) {
        if (/saiu antes/.test(err.message)) throw err;
        lastErr = err;
      }
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return true;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      try {
        const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2500) });
        if (res.ok) return true;
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err2) {
        lastErr = err2;
      }
    }
    orchestrator?.log?.(
      'devops',
      `Aguardando deploy ficar pronto (${i}/${attempts})…`,
      'info'
    );
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Deploy não respondeu em ${baseUrl} (${lastErr?.message || 'timeout'})`);
}

function getDocker() {
  if (active.docker) return active.docker;
  try {
    active.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  } catch {
    active.docker = null;
  }
  return active.docker;
}

async function verifyDocker() {
  const docker = getDocker();
  if (!docker) return false;
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

function envObjectToList(envObj = {}) {
  return Object.entries(envObj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);
}

async function stopDeploy(orchestrator) {
  if (active.container) {
    orchestrator?.log?.('devops', 'Parando container de deploy…', 'info');
    try {
      await active.container.stop({ t: 3 });
    } catch {
      // ignore
    }
    try {
      await active.container.remove({ force: true });
    } catch {
      // ignore
    }
    active.container = null;
  }
  // Limpa container órfão pelo nome padrão (ex.: após restart do control plane)
  try {
    const docker = getDocker();
    if (docker) {
      const orphan = docker.getContainer(`forja-deploy-${config.deployHostPort}`);
      await orphan.remove({ force: true });
    }
  } catch {
    // ignore
  }
  try {
    const docker = getDocker();
    if (docker && config.stagingHostPort) {
      const orphan = docker.getContainer(`forja-deploy-${config.stagingHostPort}`);
      await orphan.remove({ force: true });
    }
  } catch {
    // ignore
  }
  if (active.childProcess) {
    try {
      active.childProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    active.childProcess = null;
  }
  active.type = null;
}

function assertHostPortFree(hostPort) {
  try {
    const out = execSync(`lsof -nP -iTCP:${hostPort} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (out) {
      throw new Error(
        `Porta ${hostPort} já está em uso no host (PIDs: ${out.split(/\s+/).join(', ')}). Pare o processo antes do deploy Docker.`
      );
    }
  } catch (err) {
    if (/já está em uso/.test(err.message)) throw err;
    // lsof exit≠0 → porta livre
  }
}

/**
 * Sobe o deploy final.
 * - FORJA_REQUIRE_DOCKER=true → Docker obrigatório (fail-closed)
 * - caso contrário → subprocesso Node no host
 */
async function startDeploy({ deployDir, hostPort, env = {}, orchestrator }) {
  const start = detectStartCommand(deployDir);
  if (!start) {
    throw new Error('Projeto sem entrypoint (package.json start/main, src/server.js ou server.js)');
  }

  await stopDeploy(orchestrator);
  assertHostPortFree(hostPort);

  const requireDocker = config.requireDocker;
  const hasDocker = await module.exports.verifyDocker();
  const baseUrl = `http://127.0.0.1:${hostPort}`;

  if (requireDocker) {
    if (!hasDocker) {
      throw new Error(
        'Deploy final exige Docker (FORJA_REQUIRE_DOCKER=true), mas o daemon não está disponível.'
      );
    }

    orchestrator?.log?.(
      'devops',
      `Construindo imagem Docker de produção (${IMAGE_TAG})…`,
      'info'
    );

    // Dockerfile da forja garante PORT interno 3000 mapeado para hostPort
    const dockerfile = buildProdDockerfile(deployDir, start);
    fs.writeFileSync(path.join(deployDir, 'Dockerfile'), dockerfile, 'utf8');
    if (!fs.existsSync(path.join(deployDir, '.dockerignore'))) {
      fs.writeFileSync(
        path.join(deployDir, '.dockerignore'),
        'node_modules\n.git\n.env\n*.db\n*.db-*\ncoverage\n',
        'utf8'
      );
    }

    try {
      execSync(`docker build -t ${IMAGE_TAG} .`, { cwd: deployDir, stdio: 'ignore' });
    } catch (err) {
      throw new Error(`Falha no docker build do deploy: ${err.message}`);
    }

    const docker = getDocker();
    const containerEnv = {
      ...env,
      PORT: String(CONTAINER_PORT),
      HOST: '0.0.0.0',
      NODE_ENV: env.NODE_ENV || 'production'
    };

    try {
      active.container = await docker.createContainer({
        Image: IMAGE_TAG,
        name: `forja-deploy-${hostPort}`,
        ExposedPorts: { [`${CONTAINER_PORT}/tcp`]: {} },
        HostConfig: {
          PortBindings: {
            [`${CONTAINER_PORT}/tcp`]: [{ HostPort: String(hostPort) }]
          },
          Memory: 1024 * 1024 * 1024,
          NanoCpus: 2e9,
          NetworkMode: 'bridge',
          AutoRemove: false
        },
        Env: envObjectToList(containerEnv)
      });
    } catch (err) {
      // Nome em uso: remove e tenta de novo
      if (/Conflict|already in use/i.test(err.message || '')) {
        try {
          const old = docker.getContainer(`forja-deploy-${hostPort}`);
          await old.remove({ force: true });
        } catch {
          // ignore
        }
        active.container = await docker.createContainer({
          Image: IMAGE_TAG,
          name: `forja-deploy-${hostPort}`,
          ExposedPorts: { [`${CONTAINER_PORT}/tcp`]: {} },
          HostConfig: {
            PortBindings: {
              [`${CONTAINER_PORT}/tcp`]: [{ HostPort: String(hostPort) }]
            },
            Memory: 1024 * 1024 * 1024,
            NanoCpus: 2e9,
            NetworkMode: 'bridge'
          },
          Env: envObjectToList(containerEnv)
        });
      } else {
        throw err;
      }
    }

    await active.container.start();
    active.type = 'docker';
    orchestrator?.log?.(
      'devops',
      `Deploy Docker mapeado em ${baseUrl} (container :${CONTAINER_PORT})`,
      'success'
    );
    await waitForHttp(baseUrl, { orchestrator, container: active.container });
    orchestrator?.throwIfAborted?.();

    const running = await active.container.inspect();
    if (!running?.State?.Running) {
      throw new Error('Container de deploy iniciou e encerrou imediatamente');
    }
    return {
      type: 'docker',
      url: baseUrl,
      port: hostPort,
      containerPort: CONTAINER_PORT,
      containerId: active.container.id,
      image: IMAGE_TAG
    };
  }

  // Fallback host (somente quando Docker não é obrigatório)
  orchestrator?.log?.(
    'devops',
    `Docker opcional: subindo deploy em processo local na porta ${hostPort}…`,
    'info'
  );
  try {
    execSync('npm install --omit=dev', { cwd: deployDir, stdio: 'ignore' });
  } catch (e) {
    orchestrator?.log?.('devops', `Aviso do npm install: ${e.message}`, 'warning');
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      stopDeploy().catch(() => undefined);
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const ok = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    active.childProcess = spawn(start.cmd, start.args, {
      cwd: deployDir,
      env: {
        PATH: process.env.PATH,
        ...env,
        PORT: String(hostPort),
        HOST: env.HOST || '0.0.0.0',
        NODE_ENV: env.NODE_ENV || 'production'
      }
    });
    active.type = 'child_process';
    active.childProcess.stdout.on('data', (data) => console.log(`[DEPLOY] ${data}`));
    active.childProcess.stderr.on('data', (data) => console.error(`[DEPLOY] ${data}`));
    active.childProcess.on('error', fail);
    active.childProcess.on('exit', (code, signal) => {
      fail(new Error(`Processo de deploy encerrou cedo (code=${code}, signal=${signal})`));
    });

    waitForHttp(baseUrl, { attempts: 20, delayMs: 500, orchestrator })
      .then(() =>
        ok({
          type: 'child_process',
          url: baseUrl,
          port: hostPort
        })
      )
      .catch(fail);
  });
}

module.exports = {
  CONTAINER_PORT,
  IMAGE_TAG,
  detectStartCommand,
  buildProdDockerfile,
  waitForHttp,
  verifyDocker,
  startDeploy,
  stopDeploy,
  getActiveType: () => active.type
};
