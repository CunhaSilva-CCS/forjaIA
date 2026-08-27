# ADR-003 — Chaos engineering real via API do Docker, com fallback simulado

**Status:** Aceito · **Não validado ao vivo** (ver Consequências)

## Contexto

O agente DevOps injetava "caos" mutando duas variáveis globais em JS (`latencyModifier`, `packetLossRate`) que o load tester lia antes de cada requisição client-side. Isso nunca tocava a infraestrutura de verdade — era simulação apresentada na UI como se fosse teste de resiliência real.

## Decisão

Quando a sandbox é um container Docker real (`sandboxConfig.type === 'docker'`), o chaos passa a agir de verdade sobre esse container:

- **Latência/perda de pacotes**: um container-sidecar efêmero (`gaiadocker/iproute2`) sobe compartilhando o namespace de rede do alvo (`NetworkMode: container:<id>`) e roda `tc qdisc replace dev eth0 root netem delay Xms loss Y%` de dentro dele. Essa abordagem foi escolhida em vez de rodar `tc`/`nsenter` no host porque, no Docker Desktop (macOS/Windows), o processo Node deste servidor não compartilha kernel/namespaces com a VM onde os containers realmente rodam — só o próprio daemon Docker tem acesso a isso, então a operação precisa passar pela API do Docker, nunca pelo host diretamente.
- **CPU throttling**: `container.update({ CpuQuota, CpuPeriod })` reduz a cota real de CPU do container (não simula, throttla de verdade).
- **Fallback automático**: sem sandbox Docker disponível, ou se qualquer operação real falhar no meio do teste, cai de volta na simulação client-side de sempre — sempre visível no campo `chaosMode` reportado nas métricas (`docker-fault-injection` vs `client-side-fault-injection`) e na aba Métricas da UI.

## Consequências

- Dois bugs reais de timer não-cancelado foram introduzidos e corrigidos durante a implementação (`setTimeout` no loop de chaos, e no timeout do sidecar `tc`) — cada um inflava a suíte de testes de ~2,5s para ~8s por segurar o event loop vivo. Ambos corrigidos com `clearTimeout` explícito.
- 14 testes cobrem o contrato exato das chamadas Docker (argumentos do `tc`, `NetworkMode`, `CapAdd`, `CpuQuota`/`CpuPeriod`) contra um Docker fake, e o fallback automático quando uma operação real falha.
- **Limitação conhecida e não resolvida**: este ambiente de desenvolvimento não tem Docker disponível, então o caminho real (`tc netem`/`container.update` contra um container de verdade) nunca foi exercitado ao vivo — só contra o fake dos testes. A forma das chamadas está correta pelo contrato da API do Docker, mas isso não substitui rodar um `Forjar` de verdade com Docker ativo e conferir a aba Métricas. Fica como ação pendente para quem tiver Docker disponível.
- Trade-off aceito: a imagem `gaiadocker/iproute2` precisa ser baixada na primeira execução (download único, depois fica em cache local do Docker).
