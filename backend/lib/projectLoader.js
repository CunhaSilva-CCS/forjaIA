const fs = require('fs');
const path = require('path');
const { resolveWithinWorkspace } = require('./paths');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'data',
  'dist',
  'coverage',
  '.next',
  'tmp',
  'tmp-sandbox',
  '_reports'
]);

const TEXT_EXTS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.md',
  '.txt',
  '.env',
  '.example',
  '.yml',
  '.yaml',
  '.toml',
  '.dockerfile'
]);

const TEXT_NAMES = new Set(['Dockerfile', 'Makefile', '.env', '.env.example', '.gitignore']);

function shouldInclude(filePath, name) {
  if (TEXT_NAMES.has(name)) return true;
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  if (name === 'Dockerfile') return true;
  return false;
}

function walk(dir, root, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && !TEXT_NAMES.has(entry.name) && entry.name !== '.env.example') {
      continue;
    }
    if (entry.name === '.env') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, root, out);
      continue;
    }
    if (!shouldInclude(full, entry.name)) continue;
    const rel = path.relative(root, full);
    let content = '';
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    // skip huge files
    if (content.length > 400000) continue;
    out.push({
      name: entry.name,
      path: rel.split(path.sep).join('/'),
      content
    });
  }
}

function loadProjectFiles(relativePath) {
  const abs = resolveWithinWorkspace(relativePath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    const err = new Error(`Projeto não encontrado no workspace: ${relativePath}`);
    err.status = 404;
    throw err;
  }
  const files = [];
  walk(abs, abs, files);
  if (!files.length) {
    const err = new Error(`Nenhum arquivo de código encontrado em ${relativePath}`);
    err.status = 400;
    throw err;
  }
  return { root: abs, relativePath, files };
}

module.exports = { loadProjectFiles };
