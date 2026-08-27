# ADR-006 — Watchdog exige falhas seguidas antes de reiniciar

**Status:** Aceito · Corrigido a partir de um bug real observado ao vivo

## Contexto

Rodando o pipeline completo (Arquiteto → Codificador → QA → …) contra o ambiente real de um usuário, com o watchdog (`forja-service.js watch`) ativo, o QA travou o backend real **duas vezes seguidas**, cada vez com um PID novo (processo morto e reiniciado no meio de uma run em andamento).

Causa raiz: `sandbox/runner.js` builda a sandbox Docker via `execSync('docker build ...')` — uma chamada **síncrona** que bloqueia o event loop do Node inteiro pela duração do build (dezenas de segundos a minutos na primeira vez, baixando a imagem base `node:20-slim` e rodando `npm install`). Enquanto isso, o watchdog fazia um `GET /api/health` a cada 8s com timeout de 2,5s (`checkHealth()`); como o processo estava genuinamente ocupado (não caído), o health check nunca respondia a tempo. Na primeira falha, `watchLoop()` já concluía "processo caído" e chamava `restart()` — que mata o processo via `SIGTERM`/`SIGKILL` e sobe um novo. Isso matava builds Docker legítimos, ainda em andamento, achando que o servidor tinha travado.

## Decisão

`watchLoop()` agora exige **`FORJA_WATCH_UNHEALTHY_THRESHOLD` falhas consecutivas** (padrão 3) antes de reiniciar, não mais uma única falha. Um health check bem-sucedido zera o contador. Isso dá margem para operações síncronas longas e legítimas (o `docker build` da sandbox) sobreviverem a um watchdog de intervalo curto, mantendo a detecção de crash real (processo genuinamente caído continua respondendo com falha em TODAS as tentativas, então ainda é pego dentro de `WATCH_INTERVAL_MS × UNHEALTHY_THRESHOLD` — por padrão, ~24s).

## O que não foi corrigido agora (deliberado)

A causa raiz mais profunda — `execSync` bloqueando o event loop inteiro durante `docker build`, impedindo o control plane de responder a QUALQUER requisição (não só health check, mas também WebSocket, cancelamento de run, etc.) — continua lá. O fix certo de longo prazo é trocar `execSync` por `spawn`/build assíncrono em `sandbox/runner.js` e `lib/deployRuntime.js`, permitindo que o servidor continue respondendo durante um build. Isso é uma mudança maior, no caminho mais crítico do produto (a própria execução da sandbox), e não foi feita aqui para não introduzir risco novo numa correção que precisava ser rápida e segura. Fica registrado como débito técnico conhecido.

## Consequências

- Builds Docker legítimos e demorados não derrubam mais o control plane.
- Um processo genuinamente travado ainda é detectado e reiniciado, só que com uma janela de confirmação maior (~24s em vez de ~8s) — trade-off aceito: menos falsos positivos em troca de detecção levemente mais lenta de crashes reais.
- `FORJA_WATCH_UNHEALTHY_THRESHOLD` é configurável via `.env` para quem quiser ajustar essa margem.
