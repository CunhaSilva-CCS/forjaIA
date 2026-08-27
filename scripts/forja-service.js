#!/usr/bin/env node
/**
 * ForjaIA — controlador de serviços (manual + automático).
 *
 * Uso:
 *   node scripts/forja-service.js status
 *   node scripts/forja-service.js start
 *   node scripts/forja-service.js stop
 *   node scripts/forja-service.js restart
 *   node scripts/forja-service.js watch          # auto-reinicia se cair
 *   node scripts/forja-service.js watch --once   # um ciclo e sai
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(ROOT, 'backend', 'data');
const PID_FILE = path.join(DATA_DIR, 'forja-server.pid');
const WATCH_PID_FILE = path.join(DATA_DIR, 'forja-watch.pid');
const CMD_FILE = path.join(DATA_DIR, 'forja-service.cmd');
const LOG_FILE = path.join(DATA_DIR, 'forja-service.log');

const WATCH_INTERVAL_MS = Number(process.env.FORJA_WATCH_INTERVAL_MS || 8000);
const HEALTH_TIMEOUT_MS = Number(process.env.FORJA_HEALTH_TIMEOUT_MS || 2500);
const START_GRACE_MS = Number(process.env.FORJA_START_GRACE_MS || 90000);

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    ensureDataDir();
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function healthUrl() {
  return `http://${HOST}:${PORT}/api/health`;
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(healthUrl(), { timeout: HEALTH_TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          resolve({
            ok: res.statusCode === 200 && data.ok !== false,
            statusCode: res.statusCode,
            data
          });
        } catch {
          resolve({ ok: res.statusCode === 200, statusCode: res.statusCode, data: null });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
  });
}

function listListenPids() {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return [...new Set(out.map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0))];
  } catch {
    return [];
  }
}

function readPidFile(file) {
  try {
    const n = Number(String(fs.readFileSync(file, 'utf8')).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writePidFile(file, pid) {
  ensureDataDir();
  fs.writeFileSync(file, String(pid), 'utf8');
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPids(pids, signal = 'SIGTERM') {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
      log(`Sinal ${signal} → pid ${pid}`);
    } catch (err) {
      log(`Não foi possível sinalizar pid ${pid}: ${err.message}`);
    }
  }
}

async function waitUntil(predicate, { timeoutMs, intervalMs = 500, label = 'condição' }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout aguardando ${label} (${timeoutMs}ms)`);
}

async function status() {
  const health = await checkHealth();
  const pids = listListenPids();
  const watchPid = readPidFile(WATCH_PID_FILE);
  const watchAlive = isProcessAlive(watchPid);
  return {
    host: HOST,
    port: PORT,
    online: health.ok,
    health,
    pids,
    watch: {
      enabled: watchAlive,
      pid: watchAlive ? watchPid : null
    },
    cmdPending: fs.existsSync(CMD_FILE)
      ? String(fs.readFileSync(CMD_FILE, 'utf8')).trim()
      : null
  };
}

async function stop({ force = false } = {}) {
  const pids = listListenPids();
  const stored = readPidFile(PID_FILE);
  const all = [...new Set([...pids, stored].filter(Boolean))];
  if (!all.length) {
    log('Nenhum processo escutando — já parado.');
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
    return { stopped: true, pids: [] };
  }
  killPids(all, 'SIGTERM');
  try {
    await waitUntil(async () => listListenPids().length === 0, {
      timeoutMs: 8000,
      label: 'parada do servidor'
    });
  } catch {
    if (force) {
      killPids(listListenPids(), 'SIGKILL');
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
  log('Servidor parado.');
  return { stopped: true, pids: all };
}

function startDetached() {
  ensureDataDir();
  const out = fs.openSync(LOG_FILE, 'a');
  const child = spawn('npm', ['run', 'start:local-prod'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  });
  child.unref();
  writePidFile(PID_FILE, child.pid);
  log(`Start disparado (npm pid ${child.pid}). Aguardando health em ${healthUrl()}…`);
  return child.pid;
}

async function start() {
  const current = await status();
  if (current.online) {
    log('Servidor já está online.');
    return { started: false, alreadyRunning: true, ...current };
  }
  // limpa listeners zumbis
  if (current.pids.length) {
    await stop({ force: true });
  }
  const npmPid = startDetached();
  await waitUntil(async () => (await checkHealth()).ok, {
    timeoutMs: START_GRACE_MS,
    intervalMs: 1500,
    label: 'health OK'
  });
  const listenPids = listListenPids();
  if (listenPids[0]) writePidFile(PID_FILE, listenPids[0]);
  log(`Servidor online (pids: ${listenPids.join(', ') || npmPid}).`);
  return { started: true, npmPid, pids: listenPids };
}

async function restart() {
  log('Reiniciando serviços…');
  await stop({ force: true });
  await new Promise((r) => setTimeout(r, 800));
  return start();
}

function writeCommand(cmd) {
  ensureDataDir();
  fs.writeFileSync(CMD_FILE, `${cmd}\n`, 'utf8');
  log(`Comando enfileirado: ${cmd}`);
}

function consumeCommand() {
  try {
    if (!fs.existsSync(CMD_FILE)) return null;
    const cmd = String(fs.readFileSync(CMD_FILE, 'utf8')).trim().toLowerCase();
    fs.unlinkSync(CMD_FILE);
    return cmd || null;
  } catch {
    return null;
  }
}

async function applyCommand(cmd) {
  if (!cmd) return;
  if (cmd === 'restart') await restart();
  else if (cmd === 'stop') await stop({ force: true });
  else if (cmd === 'start') await start();
  else log(`Comando ignorado: ${cmd}`);
}

async function watchLoop({ once = false } = {}) {
  ensureDataDir();
  writePidFile(WATCH_PID_FILE, process.pid);
  log(`Watchdog ativo (intervalo ${WATCH_INTERVAL_MS}ms). Ctrl+C para sair.`);

  const cleanup = () => {
    try {
      if (readPidFile(WATCH_PID_FILE) === process.pid) fs.unlinkSync(WATCH_PID_FILE);
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // sobe se estiver down
  if (!(await checkHealth()).ok) {
    try {
      await start();
    } catch (err) {
      log(`Falha no start inicial do watchdog: ${err.message}`);
    }
  }

  do {
    const cmd = consumeCommand();
    if (cmd) {
      try {
        await applyCommand(cmd);
      } catch (err) {
        log(`Falha ao aplicar comando ${cmd}: ${err.message}`);
      }
    }

    const healthy = (await checkHealth()).ok;
    if (!healthy) {
      log('Health falhou — reinício automático.');
      try {
        await restart();
      } catch (err) {
        log(`Reinício automático falhou: ${err.message}`);
      }
    }

    if (once) break;
    await new Promise((r) => setTimeout(r, WATCH_INTERVAL_MS));
  } while (true);

  cleanup();
}

async function main() {
  const [, , actionRaw, ...rest] = process.argv;
  const action = String(actionRaw || 'status').toLowerCase();
  const once = rest.includes('--once');

  try {
    if (action === 'status') {
      const s = await status();
      console.log(JSON.stringify(s, null, 2));
      process.exit(s.online ? 0 : 1);
    }
    if (action === 'start') {
      const r = await start();
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (action === 'stop') {
      const r = await stop({ force: true });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (action === 'restart') {
      const r = await restart();
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (action === 'watch') {
      await watchLoop({ once });
      return;
    }
    if (action === 'cmd') {
      const cmd = String(rest[0] || '').toLowerCase();
      if (!['start', 'stop', 'restart'].includes(cmd)) {
        throw new Error('Uso: forja-service.js cmd <start|stop|restart>');
      }
      writeCommand(cmd);
      return;
    }
    throw new Error(`Ação desconhecida: ${action}. Use status|start|stop|restart|watch|cmd`);
  } catch (err) {
    log(`ERRO: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  status,
  start,
  stop,
  restart,
  writeCommand,
  checkHealth,
  listListenPids
};
