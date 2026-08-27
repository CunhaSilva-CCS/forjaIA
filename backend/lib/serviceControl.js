const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts', 'forja-service.js');
const DATA_DIR = path.join(__dirname, '../data');
const WATCH_PID_FILE = path.join(DATA_DIR, 'forja-watch.pid');
const CMD_FILE = path.join(DATA_DIR, 'forja-service.cmd');

function readPid(file) {
  try {
    const n = Number(String(fs.readFileSync(file, 'utf8')).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function watchRunning() {
  return isAlive(readPid(WATCH_PID_FILE));
}

async function getStatus() {
  // Prefer in-process require of the script helpers
  const svc = require(SCRIPT);
  const base = await svc.status();
  return {
    ...base,
    control: {
      watchRunning: watchRunning(),
      canSelfManage: true,
      mode: watchRunning() ? 'watchdog' : 'direct'
    }
  };
}

function enqueueCommand(cmd) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CMD_FILE, `${cmd}\n`, 'utf8');
  return { queued: true, cmd, via: 'watchdog' };
}

function spawnCtl(action) {
  const child = spawn(process.execPath, [SCRIPT, action], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' }
  });
  child.unref();
  return { spawned: true, action, pid: child.pid, via: 'direct' };
}

/**
 * Manual/auto control.
 * - Se watchdog estiver ativo: enfileira comando (reinício externo).
 * - Senão: dispara script detached (start/restart/stop).
 */
function requestAction(action) {
  const allowed = ['start', 'stop', 'restart', 'watch'];
  if (!allowed.includes(action)) {
    throw new Error(`Ação inválida: ${action}`);
  }

  if (action === 'watch') {
    if (watchRunning()) return { already: true, action: 'watch' };
    return spawnCtl('watch');
  }

  if (watchRunning() && ['start', 'stop', 'restart'].includes(action)) {
    return enqueueCommand(action);
  }

  // Sem watchdog: stop/restart precisam sobreviver ao kill do processo atual
  if (action === 'stop' || action === 'restart') {
    const result = spawnCtl(action);
    // dá tempo da resposta HTTP sair
    setTimeout(() => {
      // stop/restart matará este processo via lsof na PORT
    }, 300);
    return result;
  }

  return spawnCtl(action);
}

module.exports = {
  getStatus,
  requestAction,
  watchRunning,
  host: config.host,
  port: config.port
};
