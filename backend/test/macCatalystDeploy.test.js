const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');

process.env.FORJA_API_TOKEN = process.env.FORJA_API_TOKEN || 'test-token-forja';
process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-catalyst-${Date.now()}.db`);

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

describe('findXcodeWorkspace (ADR-018)', () => {
  it('acha o .xcworkspace dentro de ios/ e deriva o nome do scheme', () => {
    const { findXcodeWorkspace } = fresh('../lib/mobileDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-ws-'));
    fs.mkdirSync(path.join(dir, 'ios', 'MeuApp.xcworkspace'), { recursive: true });
    const ws = findXcodeWorkspace(dir);
    assert.equal(ws.workspace, 'MeuApp.xcworkspace');
    assert.equal(ws.scheme, 'MeuApp');
  });

  it('retorna null sem pasta ios/', () => {
    const { findXcodeWorkspace } = fresh('../lib/mobileDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-nows-'));
    assert.equal(findXcodeWorkspace(dir), null);
  });

  it('achado real: rejeita nome de workspace com metacaractere de shell (injeção de comando)', () => {
    // workspace/scheme acabam interpolados sem escape numa string de shell (xcodebuild ...,
    // execAsync roda com shell:true) — um nome como `Evil".xcworkspace` quebraria as aspas
    // duplas e injetaria comando arbitrário. O nome do arquivo é decidido por quem gerou o
    // projeto (o LLM, via agent/coder.js), não confiável por padrão.
    const { findXcodeWorkspace } = fresh('../lib/mobileDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-evil-ws-'));
    fs.mkdirSync(path.join(dir, 'ios', 'Evil`touch pwned`.xcworkspace'), { recursive: true });
    assert.equal(findXcodeWorkspace(dir), null);
  });

  it('aceita nome de workspace normal (letras, número, espaço, hífen)', () => {
    const { findXcodeWorkspace } = fresh('../lib/mobileDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-normal-ws-'));
    fs.mkdirSync(path.join(dir, 'ios', 'Meu App 2.xcworkspace'), { recursive: true });
    const ws = findXcodeWorkspace(dir);
    assert.equal(ws.workspace, 'Meu App 2.xcworkspace');
    assert.equal(ws.scheme, 'Meu App 2');
  });
});

describe('supportsMacCatalyst (ADR-018)', () => {
  it('true quando xcodebuild -showdestinations lista "My Mac" com variant:Mac Catalyst', async () => {
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = (cmd, args, opts) => {
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          'data',
          Buffer.from('{ platform:macOS, arch:arm64, variant:Mac Catalyst, id:X, name:My Mac }\n')
        );
        child.emit('close', 0);
      });
      return child;
    };
    try {
      fresh('../lib/dockerBuild'); // dockerBuild.js destructura spawn no topo — precisa re-requerer pra pegar o mock
      const { supportsMacCatalyst } = fresh('../lib/mobileDeploy');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-catalyst-ok-'));
      fs.mkdirSync(path.join(dir, 'ios', 'X.xcworkspace'), { recursive: true });
      assert.equal(await supportsMacCatalyst(dir), true);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('achado real: false quando "My Mac" existe mas o variant é "Designed for iPad" (não é Catalyst de verdade)', async () => {
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = (cmd, args, opts) => {
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => {
        child.stdout.emit(
          'data',
          Buffer.from('{ platform:macOS, arch:arm64, variant:Designed for [iPad,iPhone], id:X, name:My Mac }\n')
        );
        child.emit('close', 0);
      });
      return child;
    };
    try {
      fresh('../lib/dockerBuild');
      const { supportsMacCatalyst } = fresh('../lib/mobileDeploy');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-designed-for-ipad-'));
      fs.mkdirSync(path.join(dir, 'ios', 'X.xcworkspace'), { recursive: true });
      assert.equal(await supportsMacCatalyst(dir), false);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });

  it('false quando não há pasta ios/ (sem tentar rodar xcodebuild)', async () => {
    const { supportsMacCatalyst } = fresh('../lib/mobileDeploy');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-noios-'));
    assert.equal(await supportsMacCatalyst(dir), false);
  });

  it('false quando xcodebuild falha (projeto sem Catalyst configurado)', async () => {
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = () => {
      const { EventEmitter } = require('events');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      process.nextTick(() => child.emit('close', 1));
      return child;
    };
    try {
      fresh('../lib/dockerBuild'); // dockerBuild.js destructura spawn no topo — precisa re-requerer pra pegar o mock
      const { supportsMacCatalyst } = fresh('../lib/mobileDeploy');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-catalyst-fail-'));
      fs.mkdirSync(path.join(dir, 'ios', 'X.xcworkspace'), { recursive: true });
      assert.equal(await supportsMacCatalyst(dir), false);
    } finally {
      childProcess.spawn = originalSpawn;
    }
  });
});

describe('findBuiltMacApp (ADR-018)', () => {
  it('acha o .app em Build/Products/Debug-maccatalyst (Catalyst de verdade)', () => {
    const { findBuiltMacApp } = fresh('../lib/mobileDeploy');
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dd-catalyst-'));
    const productsDir = path.join(dd, 'Build', 'Products', 'Debug-maccatalyst');
    fs.mkdirSync(path.join(productsDir, 'MeuApp.app'), { recursive: true });
    assert.equal(findBuiltMacApp(dd), path.join(productsDir, 'MeuApp.app'));
  });

  it('ignora pastas de config de Simulador', () => {
    const { findBuiltMacApp } = fresh('../lib/mobileDeploy');
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dd-sim-'));
    fs.mkdirSync(path.join(dd, 'Build', 'Products', 'Debug-iphonesimulator', 'MeuApp.app'), { recursive: true });
    assert.equal(findBuiltMacApp(dd), null);
  });

  it('retorna null sem pasta Build/Products', () => {
    const { findBuiltMacApp } = fresh('../lib/mobileDeploy');
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-dd-empty-'));
    assert.equal(findBuiltMacApp(dd), null);
  });
});
