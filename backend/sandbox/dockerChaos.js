/**
 * Primitivas de fault-injection REAL contra o container da sandbox, via API do Docker.
 *
 * Por que não `nsenter`/`tc` direto no host: quando o daemon roda dentro da VM do
 * Docker Desktop (macOS/Windows), o processo Node deste servidor não compartilha o
 * kernel/namespaces dessa VM — um `tc` chamado no host não teria efeito nenhum no
 * container. A forma portátil (funciona igual em Linux nativo e em Docker Desktop) é
 * pedir para o próprio daemon Docker rodar um container-sidecar que entra no namespace
 * de rede do alvo (`NetworkMode: container:<id>`) e executa `tc` ali dentro — o daemon
 * sempre está no mesmo kernel que os containers que ele gerencia.
 *
 * CPU throttling usa `container.update()` (API nativa do Docker para CpuQuota/CpuPeriod),
 * sem precisar de sidecar.
 */

const NETEM_IMAGE = 'gaiadocker/iproute2';
const NETEM_TIMEOUT_MS = 8000;

/** Container-sidecar de vida curta, compartilhando a rede do alvo, rodando um comando `tc`. */
async function runNetemSidecar(docker, targetContainerId, tcArgs) {
  const sidecar = await docker.createContainer({
    Image: NETEM_IMAGE,
    Cmd: ['tc', ...tcArgs],
    HostConfig: {
      NetworkMode: `container:${targetContainerId}`,
      CapAdd: ['NET_ADMIN'],
      AutoRemove: true
    }
  });
  try {
    await sidecar.start();
    let timeoutHandle;
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('timeout no sidecar tc')), NETEM_TIMEOUT_MS);
    });
    try {
      await Promise.race([sidecar.wait(), timeout]);
    } finally {
      clearTimeout(timeoutHandle);
    }
  } finally {
    try {
      await sidecar.remove({ force: true });
    } catch {
      // AutoRemove já deve ter limpado; ignora "no such container"
    }
  }
}

/** Injeta latência/perda de pacotes reais na interface de rede do container alvo. */
async function injectNetworkFault({ docker, containerId, delayMs = 0, lossPercent = 0 }) {
  const parts = ['qdisc', 'replace', 'dev', 'eth0', 'root', 'netem'];
  if (delayMs > 0) parts.push('delay', `${delayMs}ms`);
  if (lossPercent > 0) parts.push('loss', `${lossPercent}%`);
  if (delayMs <= 0 && lossPercent <= 0) return clearNetworkFault({ docker, containerId });
  await runNetemSidecar(docker, containerId, parts);
}

/** Remove qualquer fault de rede injetado (idempotente — ignora "nada para remover"). */
async function clearNetworkFault({ docker, containerId }) {
  try {
    await runNetemSidecar(docker, containerId, ['qdisc', 'del', 'dev', 'eth0', 'root']);
  } catch (err) {
    if (!/No such qdisc|Cannot delete/i.test(err.message || '')) throw err;
  }
}

/** Reduz de verdade a cota de CPU do container (não é simulação — o container fica mais lento). */
async function throttleCpu({ docker, containerId, quotaMicros, periodMicros = 100000 }) {
  const container = docker.getContainer(containerId);
  await container.update({ CpuPeriod: periodMicros, CpuQuota: quotaMicros });
}

/** Restaura a cota de CPU original do container. */
async function resetCpu({ docker, containerId, quotaMicros = 0, periodMicros = 100000 }) {
  const container = docker.getContainer(containerId);
  await container.update({ CpuPeriod: periodMicros, CpuQuota: quotaMicros });
}

/** True quando a sandbox atual é um container Docker real que podemos manipular. */
function isAvailable(sandboxConfig) {
  return Boolean(
    sandboxConfig?.type === 'docker' && sandboxConfig?.containerId && sandboxConfig?.runner?.docker
  );
}

module.exports = {
  NETEM_IMAGE,
  isAvailable,
  injectNetworkFault,
  clearNetworkFault,
  throttleCpu,
  resetCpu
};
