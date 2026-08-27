const fs = require('fs');
const path = require('path');
const config = require('./config');

function resolveWithinWorkspace(targetPath, { mustExist = false } = {}) {
  const root = path.resolve(config.workspaceRoot);
  let rootReal = root;
  try {
    if (fs.existsSync(root)) rootReal = fs.realpathSync(root);
  } catch {
    rootReal = root;
  }
  const raw = targetPath == null || targetPath === '' ? '.' : String(targetPath);

  // path.resolve(root, abs) ignores root — still validate the abs path is inside root
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(rootReal, raw);

  const relative = path.relative(rootReal, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Caminho sai da raiz do workspace: ${targetPath}`);
  }

  if (fs.existsSync(resolved)) {
    let real;
    try {
      real = fs.realpathSync(resolved);
    } catch {
      throw new Error(`Não foi possível resolver o caminho: ${targetPath}`);
    }
    const realRel = path.relative(rootReal, real);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new Error(`Link simbólico sai da raiz do workspace: ${targetPath}`);
    }
    return real;
  }

  if (mustExist) {
    throw new Error(`Caminho não existe: ${targetPath}`);
  }

  return resolved;
}

function toRel(root, abs) {
  const rel = path.relative(root, abs);
  return rel === '' ? '.' : rel;
}

function browseWorkspace(targetPath) {
  const root = path.resolve(config.workspaceRoot);
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  let requested;
  try {
    requested = resolveWithinWorkspace(targetPath || '.');
  } catch {
    requested = root;
  }

  const exists = fs.existsSync(requested) && fs.statSync(requested).isDirectory();

  // List directories from the nearest existing ancestor (so navigation still works)
  let listDir = requested;
  if (!exists) {
    listDir = path.dirname(requested);
    while (!fs.existsSync(listDir) || !fs.statSync(listDir).isDirectory()) {
      const parent = path.dirname(listDir);
      if (parent === listDir || path.relative(root, parent).startsWith('..')) {
        listDir = root;
        break;
      }
      listDir = parent;
    }
  }

  const entries = fs.readdirSync(listDir, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    try {
      if (entry.isDirectory()) {
        const full = path.join(listDir, entry.name);
        resolveWithinWorkspace(toRel(root, full));
        directories.push({
          name: entry.name,
          path: toRel(root, full)
        });
      }
    } catch {
      // skip
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name));

  const currentAbs = exists ? requested : requested;
  const relCurrent = toRel(root, currentAbs);
  const parentAbs = path.dirname(path.resolve(root, relCurrent === '.' ? root : path.join(root, relCurrent)));
  const parentRel =
    relCurrent === '.' || path.relative(root, parentAbs).startsWith('..')
      ? null
      : toRel(root, parentAbs);

  return {
    workspaceRoot: root,
    currentPath: relCurrent,
    parentPath: parentRel,
    exists,
    listingPath: toRel(root, listDir),
    directories
  };
}

function mkdirInWorkspace(targetPath) {
  const resolved = resolveWithinWorkspace(targetPath);
  fs.mkdirSync(resolved, { recursive: true });
  return browseWorkspace(path.relative(config.workspaceRoot, resolved) || '.');
}

function safeRmDir(targetAbs) {
  const root = path.resolve(config.workspaceRoot);
  const resolved = path.isAbsolute(targetAbs)
    ? resolveWithinWorkspace(targetAbs)
    : resolveWithinWorkspace(targetAbs);
  if (resolved === root) {
    throw new Error('Recusando apagar a raiz do workspace');
  }
  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function listWorkspaceProjects() {
  const root = path.resolve(config.workspaceRoot);
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  const skip = new Set(['_reports', 'node_modules', 'tmp', 'tmp-sandbox', '.git']);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (skip.has(entry.name)) continue;
    items.push({
      name: entry.name,
      path: entry.name
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return items;
}

module.exports = {
  resolveWithinWorkspace,
  ensureWithinWorkspace: resolveWithinWorkspace,
  browseWorkspace,
  mkdirInWorkspace,
  safeRmDir,
  listWorkspaceProjects
};
