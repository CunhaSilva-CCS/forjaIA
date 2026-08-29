const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-dockerbuild-db-${Date.now()}.db`);

const {
  detectStartCommand,
  needsCompile,
  needsDevDependencies,
  needsNativeBuild,
  buildDockerfile,
  ensureTsconfig
} = require('../lib/dockerBuild');

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

  it('achado real (RAG travada em produção, ADR-037): false quando o start roda tsx/ts-node direto, mesmo com scripts.build presente', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc', start: 'tsx src/index.ts' } })
    );
    assert.equal(needsCompile(dir, { cmd: 'npm', args: ['start'] }), false);
  });

  it('false com ts-node também (mesmo raciocínio do tsx)', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc', start: 'ts-node src/index.ts' } })
    );
    assert.equal(needsCompile(dir, { cmd: 'npm', args: ['start'] }), false);
  });
});

describe('dockerBuild.needsDevDependencies (ADR-037 — achado ao vivo, regressão do próprio fix de tsx)', () => {
  it('achado real: projeto tsx precisa de devDependencies mesmo sem precisar compilar — senão o container morre com "tsx: not found"', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc', start: 'tsx src/index.ts' } })
    );
    assert.equal(needsCompile(dir, { cmd: 'npm', args: ['start'] }), false);
    assert.equal(needsDevDependencies(dir, { cmd: 'npm', args: ['start'] }), true);
  });

  it('false pra um projeto JS simples sem tsx nem build', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
    assert.equal(needsDevDependencies(dir, { args: ['server.js'] }), false);
  });

  it('true quando precisa compilar de verdade (dist/ via node), mesma resposta de needsCompile', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    assert.equal(needsDevDependencies(dir, { args: ['dist/main.js'] }), true);
  });
});

describe('dockerBuild.ensureTsconfig (ADR-037)', () => {
  it('achado real: cria tsconfig.json padrão quando o Codificador não escreveu nenhum', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc', start: 'node dist/index.js' } }));
    const created = ensureTsconfig(dir);
    assert.equal(created, true);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'));
    assert.equal(written.compilerOptions.module, 'commonjs');
  });

  it('usa module NodeNext quando package.json declara "type":"module"', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    ensureTsconfig(dir);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'));
    assert.equal(written.compilerOptions.module, 'NodeNext');
  });

  it('não sobrescreve um tsconfig.json já existente', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    const created = ensureTsconfig(dir);
    assert.equal(created, false);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'));
    assert.equal(written.compilerOptions.strict, true);
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

  it('achado real (ADR-037): projeto que precisa compilar mas não tem tsconfig.json ganha um padrão em disco antes do build', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc', start: 'node dist/index.js' } }));
    assert.equal(fs.existsSync(path.join(dir, 'tsconfig.json')), false);
    buildDockerfile(dir, { cmd: 'node', args: ['dist/index.js'] });
    assert.equal(fs.existsSync(path.join(dir, 'tsconfig.json')), true);
  });

  it('achado real (ADR-037): projeto tsx instala devDependencies (sem --omit=dev) mesmo sem gerar build step', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc', start: 'tsx src/index.ts' } })
    );
    const df = buildDockerfile(dir, { cmd: 'npm', args: ['start'] });
    assert.match(df, /RUN npm install\n/);
    assert.doesNotMatch(df, /npm run build \|\| /);
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
