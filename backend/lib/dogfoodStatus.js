const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const DEFAULT_REPORT_DIR = path.join(config.dataDir, 'dogfood-reports');

function defaultReadCrontab() {
  return execFileSync('crontab', ['-l'], { encoding: 'utf8' });
}

// Ver ADR-035: o agendamento em si vive no crontab do usuário, não no banco do ForjaIA — checar
// se está ativo significa perguntar ao próprio SO, não a uma flag que a gente guardaria e que
// poderia ficar dessincronizada se alguém editar o crontab na mão.
function readSchedule(readCrontab = defaultReadCrontab) {
  try {
    const out = readCrontab();
    const line = out
      .split('\n')
      .find(
        (l) => (l.includes('dogfood-forge.js') || l.includes('npm run dogfood')) && !l.trim().startsWith('#')
      );
    return { scheduled: Boolean(line), cronLine: line ? line.trim() : null };
  } catch {
    // Sem crontab configurado (ou `crontab` indisponível) não é um erro — só significa "inativo".
    return { scheduled: false, cronLine: null };
  }
}

function readLastRun(reportDir = DEFAULT_REPORT_DIR) {
  let files;
  try {
    files = fs.readdirSync(reportDir).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }
  if (!files.length) return null;
  files.sort();
  const last = files[files.length - 1];
  try {
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, last), 'utf8'));
    return {
      startedAt: report.startedAt || null,
      finishedAt: report.finishedAt || null,
      outcome: report.outcome || null,
      runId: report.runId || null,
      testsPassed: report.tests?.passed ?? null,
      testsTotal: report.tests?.total ?? null
    };
  } catch {
    return null;
  }
}

function getDogfoodStatus({ readCrontab, reportDir } = {}) {
  const schedule = readSchedule(readCrontab);
  const lastRun = readLastRun(reportDir);
  return { ...schedule, lastRun };
}

module.exports = { getDogfoodStatus, __test__: { readSchedule, readLastRun, DEFAULT_REPORT_DIR } };
