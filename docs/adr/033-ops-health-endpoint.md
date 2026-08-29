# ADR-033 — Endpoint de saúde operacional agregada

**Status:** Aceito

## Contexto

Até este ADR, a única forma de saber que algo estava sistematicamente errado no ForjaIA era um
humano olhando o terminal ou lendo relatório de run por run. O sistema já calcula e guarda vários
sinais individuais que, juntos, respondem "está tudo bem?" — sequência de falhas recentes (nos
próprios status das runs), provedor de LLM em cooldown por billing (ADR-015/017), uma run
executando há tempo desproporcional — mas nenhum lugar os agregava. Apontado como a lacuna mais
séria de "profissional e robusto" numa auto-avaliação do próprio projeto: "hoje a detecção de
problema depende de alguém estar olhando".

## Decisão

**`lib/opsHealth.js`** (novo): `computeOpsHealth({ runsList, cooldowns, orchestrator })` — função
pura, testável sem servidor:
- `recentFailureStreak`: quantas das runs mais recentes falharam SEGUIDAS, a partir da mais
  recente, parando no primeiro sucesso/status não-falho. Deliberadamente NÃO conta `cancelled`
  como falha — cancelamento é uma ação intencional do usuário, não um sinal de sistema quebrado
  (confirmado ao vivo: o banco de dev tinha 20 runs `cancelled` seguidas de testes desta sessão, e
  o cálculo corretamente reportou `recentFailureStreak: 0`, não 20).
- `stuckRun`: uma run `isExecuting:true` rodando há mais que `FORJA_STUCK_RUN_MS` (default 45min,
  folga sobre o `HARD_TIMEOUT_MS` de 15min do `expo run:*`) — runs `awaiting_approval` nunca contam
  (ficar parado esperando aprovação é o comportamento normal e esperado do pipeline).
- `activeCooldowns`: repassa `providerCooldown.listActive()` (já existia, ver ADR-017), cada um
  vira um alerta `LOW` (aviso, não incidente — não derruba `ok`).
- `alerts`: lista combinada, cada item com `severity` (`HIGH`/`MEDIUM`/`LOW`) e mensagem legível.
  `ok` é `false` só quando existe alerta `HIGH` ou `MEDIUM` — cooldown de provedor sozinho não
  derruba o status geral.

**`GET /api/ops/health`** (novo, autenticado — diferente do `/api/health` público, que só cobre "o
processo está de pé"): expõe o resultado, pensado pra um `curl` + cron/monitor externo verificar
periodicamente sem exigir nenhuma infraestrutura de observabilidade nova (sem Prometheus,
OpenTelemetry ou Sentry — decisão deliberada de escopo: se um dia isso não bastar, é uma decisão de
escala separada, não algo pra assumir sozinho aqui).

## Verificação ao vivo

Subi o servidor real e chamei `GET /api/ops/health` com o token real contra o banco de
desenvolvimento de verdade (não um fixture) — confirmei que `recentFailureStreak` distinguiu
corretamente 20 runs `cancelled` reais (de testes anteriores desta sessão) de uma sequência de
falha real, e que a resposta tem o formato esperado.

## Consequências

- Backend: 10 testes novos em `opsHealth.test.js` (streak de falha, `lastSuccessfulRunAt`, run
  travada com e sem orchestrator disponível, cooldown como alerta LOW que não derruba `ok`), mais 1
  teste de integração HTTP confirmando autenticação e formato da resposta.
- Não há UI pra isso ainda — é um endpoint JSON, pensado pra consumo por script/monitor externo,
  seguindo o mesmo padrão incremental que `lib/independentAudit.js` teve (ADR-021, CLI-first,
  ganhou UI só depois no ADR-023 quando fez sentido). Um card na UI é continuação natural, não
  escopo deste ADR.
- Não substitui log estruturado nem alerta push (e-mail/Slack/webhook) — é o degrau mínimo que
  torna o estado já calculável, verificável por fora sem exigir que alguém leia log. Automatizar o
  monitoramento em si (cron rodando `curl` e avisando alguém) continua sendo responsabilidade de
  operação de cada instalação, mesma postura do backup (ADR-032).
