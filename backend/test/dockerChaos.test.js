const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.FORJA_DB_PATH = process.env.FORJA_DB_PATH || path.join(os.tmpdir(), `forja-dockerchaos-${Date.now()}.db`);

const dockerChaos = require('../sandbox/dockerChaos');

function fakeDocker() {
  const calls = { createContainer: [], getContainer: [] };
  const sidecar = {
    start: async () => {},
    wait: async () => ({ StatusCode: 0 }),
    remove: async () => {}
  };
  const targetContainer = {
    update: async (opts) => {
      calls.getContainer.push(opts);
    }
  };
  return {
    calls,
    createContainer: async (opts) => {
      calls.createContainer.push(opts);
      return sidecar;
    },
    getContainer: (id) => {
      calls.getContainer.push({ id });
      return targetContainer;
    }
  };
}

describe('dockerChaos.isAvailable', () => {
  it('false sem sandboxConfig', () => {
    assert.equal(dockerChaos.isAvailable(null), false);
    assert.equal(dockerChaos.isAvailable(undefined), false);
  });

  it('false quando o tipo não é docker', () => {
    assert.equal(dockerChaos.isAvailable({ type: 'child_process', containerId: 'x', runner: { docker: {} } }), false);
  });

  it('false quando falta containerId ou runner.docker', () => {
    assert.equal(dockerChaos.isAvailable({ type: 'docker', runner: { docker: {} } }), false);
    assert.equal(dockerChaos.isAvailable({ type: 'docker', containerId: 'abc', runner: {} }), false);
  });

  it('true quando type=docker + containerId + runner.docker presentes', () => {
    assert.equal(
      dockerChaos.isAvailable({ type: 'docker', containerId: 'abc', runner: { docker: {} } }),
      true
    );
  });
});

describe('dockerChaos.injectNetworkFault', () => {
  it('roda um sidecar tc com NetworkMode compartilhando o container alvo', async () => {
    const docker = fakeDocker();
    await dockerChaos.injectNetworkFault({ docker, containerId: 'target123', delayMs: 250, lossPercent: 0 });
    assert.equal(docker.calls.createContainer.length, 1);
    const opts = docker.calls.createContainer[0];
    assert.equal(opts.Image, dockerChaos.NETEM_IMAGE);
    assert.deepEqual(opts.HostConfig.NetworkMode, 'container:target123');
    assert.deepEqual(opts.HostConfig.CapAdd, ['NET_ADMIN']);
    assert.equal(opts.HostConfig.AutoRemove, true);
    assert.match(opts.Cmd.join(' '), /tc qdisc replace dev eth0 root netem delay 250ms/);
  });

  it('inclui loss no comando tc quando lossPercent > 0', async () => {
    const docker = fakeDocker();
    await dockerChaos.injectNetworkFault({ docker, containerId: 'target123', delayMs: 50, lossPercent: 20 });
    const opts = docker.calls.createContainer[0];
    assert.match(opts.Cmd.join(' '), /delay 50ms loss 20%/);
  });

  it('sem delay nem loss, cai para clearNetworkFault (qdisc del)', async () => {
    const docker = fakeDocker();
    await dockerChaos.injectNetworkFault({ docker, containerId: 'target123', delayMs: 0, lossPercent: 0 });
    const opts = docker.calls.createContainer[0];
    assert.match(opts.Cmd.join(' '), /tc qdisc del dev eth0 root/);
  });
});

describe('dockerChaos.clearNetworkFault', () => {
  it('roda tc qdisc del e não lança se já não havia qdisc', async () => {
    const docker = fakeDocker();
    docker.createContainer = async (opts) => {
      docker.calls.createContainer.push(opts);
      return {
        start: async () => {},
        wait: async () => {
          throw new Error('No such qdisc');
        },
        remove: async () => {}
      };
    };
    await assert.doesNotReject(() => dockerChaos.clearNetworkFault({ docker, containerId: 'x' }));
  });
});

describe('dockerChaos CPU quota', () => {
  it('throttleCpu chama container.update com a quota reduzida', async () => {
    const docker = fakeDocker();
    await dockerChaos.throttleCpu({ docker, containerId: 'target123', quotaMicros: 20000, periodMicros: 100000 });
    assert.equal(docker.calls.getContainer.length, 2); // 1 chamada de rastreio + 1 update
  });

  it('resetCpu restaura a quota cheia', async () => {
    const docker = fakeDocker();
    let updateArgs = null;
    docker.getContainer = (id) => ({
      update: async (opts) => {
        updateArgs = opts;
      }
    });
    await dockerChaos.resetCpu({ docker, containerId: 'target123', quotaMicros: 200000, periodMicros: 100000 });
    assert.deepEqual(updateArgs, { CpuPeriod: 100000, CpuQuota: 200000 });
  });
});
