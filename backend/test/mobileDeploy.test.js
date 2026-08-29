const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const childProcess = require('child_process');

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** child_process.spawn mockado: captura o pid/kill/unref, mas fs continua real — o próprio
 * runExpoRunIos abre um arquivo de log de verdade (fs.openSync) antes de spawnar; o teste escreve
 * nesse mesmo arquivo pra simular a saída do processo real, sem precisar de um filho de verdade. */
function fakeChild() {
  const child = new EventEmitter();
  child.pid = 99999;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  child.unref = () => {
    child.unrefed = true;
  };
  return child;
}

describe('mobileDeploy.runExpoRunIos (ADR-014 fix — achado real na validação do secPass)', () => {
  // expo run:ios nunca fecha sozinho (fica como servidor Metro) — a promise tinha que resolver
  // por outro sinal, não por child.on('close'/'exit') com sucesso, senão trava pra sempre mesmo
  // com o app já rodando. E stdio vai pra ARQUIVO, não pra pipe do processo pai — um pipe quebra
  // quando o ForjaIA reinicia (comum em dev), matando o Metro/app junto mesmo com detached+unref.

  it('resolve ao ver uma frase de sucesso conhecida no log, sem matar o processo', async () => {
    let spawnedChild;
    let capturedLogPath = null;
    const originalSpawn = childProcess.spawn;
    const originalOpenSync = fs.openSync;
    childProcess.spawn = (...args) => {
      spawnedChild = fakeChild();
      return spawnedChild;
    };
    fs.openSync = (p, ...rest) => {
      capturedLogPath = p;
      return originalOpenSync(p, ...rest);
    };
    try {
      // expoRunProcess.js (extraído de mobileDeploy.js) destrutura `spawn` de child_process no
      // topo do módulo — precisa ser fresh()-ado DEPOIS do mock acima, senão a referência local já
      // cacheada continua apontando pro spawn real (mesmo bug de padrão já visto com generateJson
      // em lib/llm.js).
      fresh('../lib/expoRunProcess');
      const mobileDeploy = fresh('../lib/mobileDeploy');
      const promise = mobileDeploy.__test__.runExpoRunIos('/tmp/x', 'udid-1');
      assert.ok(capturedLogPath, 'esperava que um arquivo de log fosse aberto');

      fs.appendFileSync(capturedLogPath, '› Opening on iPhone 17 Pro\n');

      const result = await promise;
      assert.ok(result);
      assert.equal(spawnedChild.killed, false, 'não deveria matar o processo — Metro precisa continuar servindo o app');
      assert.equal(spawnedChild.unrefed, true);
    } finally {
      childProcess.spawn = originalSpawn;
      fs.openSync = originalOpenSync;
      if (capturedLogPath) fs.rm(capturedLogPath, () => {});
    }
  });

  it('mata o grupo de processos (PID negativo) quando o signal é abortado', async () => {
    let spawnedChild;
    let capturedLogPath = null;
    const originalSpawn = childProcess.spawn;
    const originalOpenSync = fs.openSync;
    const originalKill = process.kill;
    let killedPid = null;
    process.kill = (pid, sig) => {
      killedPid = pid;
    };
    childProcess.spawn = () => {
      spawnedChild = fakeChild();
      return spawnedChild;
    };
    fs.openSync = (p, ...rest) => {
      capturedLogPath = p;
      return originalOpenSync(p, ...rest);
    };
    try {
      // expoRunProcess.js (extraído de mobileDeploy.js) destrutura `spawn` de child_process no
      // topo do módulo — precisa ser fresh()-ado DEPOIS do mock acima, senão a referência local já
      // cacheada continua apontando pro spawn real (mesmo bug de padrão já visto com generateJson
      // em lib/llm.js).
      fresh('../lib/expoRunProcess');
      const mobileDeploy = fresh('../lib/mobileDeploy');
      const controller = new AbortController();
      const promise = mobileDeploy.__test__.runExpoRunIos('/tmp/x', 'udid-1', { signal: controller.signal });
      controller.abort();
      await assert.rejects(promise, /Abortado/);
      assert.equal(killedPid, -spawnedChild.pid, 'deveria matar o grupo inteiro (PID negativo), não só o processo líder');
    } finally {
      childProcess.spawn = originalSpawn;
      fs.openSync = originalOpenSync;
      process.kill = originalKill;
      if (capturedLogPath) fs.rm(capturedLogPath, () => {});
    }
  });

  it('rejeita se o processo sair com código diferente de zero antes de qualquer sinal de sucesso', async () => {
    let spawnedChild;
    let capturedLogPath = null;
    const originalSpawn = childProcess.spawn;
    const originalOpenSync = fs.openSync;
    childProcess.spawn = () => {
      spawnedChild = fakeChild();
      return spawnedChild;
    };
    fs.openSync = (p, ...rest) => {
      capturedLogPath = p;
      return originalOpenSync(p, ...rest);
    };
    try {
      // expoRunProcess.js (extraído de mobileDeploy.js) destrutura `spawn` de child_process no
      // topo do módulo — precisa ser fresh()-ado DEPOIS do mock acima, senão a referência local já
      // cacheada continua apontando pro spawn real (mesmo bug de padrão já visto com generateJson
      // em lib/llm.js).
      fresh('../lib/expoRunProcess');
      const mobileDeploy = fresh('../lib/mobileDeploy');
      const promise = mobileDeploy.__test__.runExpoRunIos('/tmp/x', 'udid-1');
      spawnedChild.emit('exit', 1);
      await assert.rejects(promise, /código 1/);
    } finally {
      childProcess.spawn = originalSpawn;
      fs.openSync = originalOpenSync;
      if (capturedLogPath) fs.rm(capturedLogPath, () => {});
    }
  });

  it('resolve por período de silêncio quando não há frase de sucesso reconhecível (heurística)', async () => {
    let spawnedChild;
    let capturedLogPath = null;
    const originalSpawn = childProcess.spawn;
    const originalOpenSync = fs.openSync;
    const originalKill = process.kill;
    process.kill = () => {};
    childProcess.spawn = () => {
      spawnedChild = fakeChild();
      return spawnedChild;
    };
    fs.openSync = (p, ...rest) => {
      capturedLogPath = p;
      return originalOpenSync(p, ...rest);
    };
    const controller = new AbortController();
    try {
      // expoRunProcess.js (extraído de mobileDeploy.js) destrutura `spawn` de child_process no
      // topo do módulo — precisa ser fresh()-ado DEPOIS do mock acima, senão a referência local já
      // cacheada continua apontando pro spawn real (mesmo bug de padrão já visto com generateJson
      // em lib/llm.js).
      fresh('../lib/expoRunProcess');
      const mobileDeploy = fresh('../lib/mobileDeploy');
      const promise = mobileDeploy.__test__.runExpoRunIos('/tmp/x', 'udid-1', { signal: controller.signal });
      promise.catch(() => {}); // será abortada no cleanup — evita unhandledRejection
      fs.appendFileSync(capturedLogPath, 'building... nada reconhecível aqui\n');
      // Não é o objetivo deste teste esperar os 45s reais da constante de produção — só confirma
      // que, com output presente e nenhum marcador, a promise NÃO resolve rápido demais.
      await sleep(300);
      let resolved = false;
      promise.then(
        () => {
          resolved = true;
        },
        () => {}
      );
      await sleep(50);
      assert.equal(resolved, false, 'não deveria resolver antes do período de silêncio configurado');
    } finally {
      controller.abort(); // encerra o timer/interval pendentes desta chamada antes do teste acabar
      childProcess.spawn = originalSpawn;
      fs.openSync = originalOpenSync;
      process.kill = originalKill;
      if (capturedLogPath) fs.rm(capturedLogPath, () => {});
    }
  });
});
