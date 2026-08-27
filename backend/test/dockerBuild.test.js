const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { detectStartCommand, needsCompile, needsNativeBuild, buildDockerfile } = require('../lib/dockerBuild');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dockerbuild-'));
}

describe('dockerBuild.detectStartCommand', () => {
  it('retorna null quando não há package.json nem server.js/src/server.js', () => {
    const dir = tmpDir();
    assert.equal(detectStartCommand(dir), null);
  });

  it('usa package.json scripts.start quando é `node <arquivo>`', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { start: 'node dist/main.js' } })
    );
    assert.deepEqual(detectStartCommand(dir), { cmd: 'node', args: ['dist/main.js'] });
  });

  it('cai para `npm start` quando scripts.start não começa com node', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'next start' } }));
    assert.deepEqual(detectStartCommand(dir), { cmd: 'npm', args: ['start'] });
  });

  it('usa package.json.main quando não há scripts.start', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ main: 'index.js' }));
    assert.deepEqual(detectStartCommand(dir), { cmd: 'node', args: ['index.js'] });
  });

  it('cai para src/server.js quando existe e o package.json não ajuda', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/server.js'), '');
    assert.deepEqual(detectStartCommand(dir), { cmd: 'node', args: ['src/server.js'] });
  });

  it('cai para server.js na raiz quando existe', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'server.js'), '');
    assert.deepEqual(detectStartCommand(dir), { cmd: 'node', args: ['server.js'] });
  });
});

describe('dockerBuild.needsCompile', () => {
  it('true quando há scripts.build', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }));
    assert.equal(needsCompile(dir, null), true);
  });

  it('true quando há tsconfig.json', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    assert.equal(needsCompile(dir, null), true);
  });

  it('true quando o entrypoint aponta para dist/ ou .ts', () => {
    const dir = tmpDir();
    assert.equal(needsCompile(dir, { args: ['dist/main.js'] }), true);
    assert.equal(needsCompile(dir, { args: ['src/main.ts'] }), true);
  });

  it('false para um projeto JS simples sem build', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
    assert.equal(needsCompile(dir, { args: ['server.js'] }), false);
  });
});

describe('dockerBuild.needsNativeBuild', () => {
  it('true quando o package.json referencia better-sqlite3', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'better-sqlite3': '^9.0.0' } })
    );
    assert.equal(needsNativeBuild(dir), true);
  });

  it('false para um projeto sem dependências nativas', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '^4.19.2' } }));
    assert.equal(needsNativeBuild(dir), false);
  });

  it('false quando não há package.json', () => {
    const dir = tmpDir();
    assert.equal(needsNativeBuild(dir), false);
  });
});

describe('dockerBuild.buildDockerfile', () => {
  it('usa containerPort e nodeEnv informados', () => {
    const dir = tmpDir();
    const df = buildDockerfile(dir, { cmd: 'node', args: ['server.js'] }, { containerPort: 4321, nodeEnv: 'test' });
    assert.match(df, /FROM node:20-slim/);
    assert.match(df, /ENV PORT=4321/);
    assert.match(df, /ENV NODE_ENV=test/);
    assert.match(df, /EXPOSE 4321/);
    assert.match(df, /\["node","server\.js"\]/);
  });

  it('usa os defaults (3000/test) quando as opções são omitidas', () => {
    const dir = tmpDir();
    const df = buildDockerfile(dir, { cmd: 'node', args: ['server.js'] });
    assert.match(df, /ENV PORT=3000/);
    assert.match(df, /ENV NODE_ENV=test/);
  });

  it('inclui RUN npm install (sem --omit=dev) quando precisa compilar', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    const df = buildDockerfile(dir, { cmd: 'node', args: ['dist/main.js'] });
    assert.match(df, /RUN npm install\n/);
    assert.doesNotMatch(df.split('\n').find((l) => l.startsWith('RUN npm install')), /--omit=dev/);
  });

  it('inclui --omit=dev quando não precisa compilar', () => {
    const dir = tmpDir();
    const df = buildDockerfile(dir, { cmd: 'node', args: ['server.js'] });
    assert.match(df, /RUN npm install --omit=dev/);
  });

  it('adiciona deps nativas de build quando o projeto usa better-sqlite3', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'better-sqlite3': '^9.0.0' } })
    );
    const df = buildDockerfile(dir, { cmd: 'node', args: ['server.js'] });
    assert.match(df, /apt-get install -y --no-install-recommends python3 make g\+\+/);
  });
});
