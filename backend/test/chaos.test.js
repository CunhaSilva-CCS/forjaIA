const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function fresh(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

function fakeOrchestrator() {
  const logs = [];
  const broadcasts = [];
  return {
    logs,
    broadcasts,
    log: (agent, message, type) => logs.push({ agent, message, type }),
    broadcast: (event, data) => broadcasts.push({ event, data })
  };
}

function fakeDockerSandboxConfig() {
  return { type: 'docker', containerId: 'c1', runner: { docker: {} } };
}

describe('chaos sem sandbox Docker disponível', () => {
  it('cai para simulação client-side e getMode reflete isso', async () => {
    const chaos = fresh('../sandbox/chaos');
    const orch = fakeOrchestrator();
    chaos.start(orch, null);
    assert.equal(chaos.getMode(), 'client-side-fault-injection');
    assert.ok(orch.logs.some((l) => /simulação de falhas no cliente/.test(l.message)));
    await chaos.stop(orch, null);
  });

  it('o ciclo de cenários simulados muda latencyModifier ao longo do tempo', async () => {
    const chaos = fresh('../sandbox/chaos');
    const orch = fakeOrchestrator();
    chaos.start(orch, undefined);
    assert.equal(chaos.getLatencyModifier(), 0);
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(chaos.getLatencyModifier() >= 0);
    assert.ok(orch.broadcasts.some((b) => b.event === 'chaos-injected' && b.data.real === false));
    await chaos.stop(orch, undefined);
    assert.equal(chaos.getLatencyModifier(), 0);
  });
});

describe('chaos com sandbox Docker real', () => {
  it('usa dockerChaos de verdade e reporta docker-fault-injection', async () => {
    const dockerChaos = fresh('../sandbox/dockerChaos');
    const calls = [];
    dockerChaos.injectNetworkFault = async (args) => calls.push(['inject', args]);
    dockerChaos.clearNetworkFault = async (args) => calls.push(['clear', args]);
    dockerChaos.throttleCpu = async (args) => calls.push(['throttle', args]);
    dockerChaos.resetCpu = async (args) => calls.push(['reset', args]);

    const chaos = fresh('../sandbox/chaos');
    const orch = fakeOrchestrator();
    const sandboxConfig = fakeDockerSandboxConfig();

    chaos.start(orch, sandboxConfig);
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(chaos.getMode(), 'docker-fault-injection');
    assert.ok(calls.length >= 1, 'esperava ao menos uma operação real de chaos');
    assert.ok(orch.broadcasts.some((b) => b.event === 'chaos-injected' && b.data.real === true));

    await chaos.stop(orch, sandboxConfig);
    assert.ok(calls.some(([kind]) => kind === 'clear'), 'stop deve limpar o fault de rede');
    assert.ok(calls.some(([kind]) => kind === 'reset'), 'stop deve restaurar a cota de CPU');
  });

  it('se a operação real falhar, cai para simulação client-side sem travar', async () => {
    const dockerChaos = fresh('../sandbox/dockerChaos');
    dockerChaos.injectNetworkFault = async () => {
      throw new Error('docker indisponível no meio do teste');
    };
    dockerChaos.clearNetworkFault = async () => {};
    dockerChaos.throttleCpu = async () => {};
    dockerChaos.resetCpu = async () => {};

    const chaos = fresh('../sandbox/chaos');
    const orch = fakeOrchestrator();
    const sandboxConfig = fakeDockerSandboxConfig();

    chaos.start(orch, sandboxConfig);
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(chaos.getMode(), 'client-side-fault-injection');
    assert.ok(orch.logs.some((l) => /Chaos real falhou/.test(l.message)));
    await chaos.stop(orch, sandboxConfig);
  });
});
