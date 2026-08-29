# ADR-035 — Dogfooding automático e agendado

**Status:** Aceito

## Contexto

A sessão de dogfooding ao vivo que originou o ADR-034 achou um bug real (QA reprovando código
correto por acoplamento com o formato dos mocks) só porque alguém ficou sentado assistindo cada
etapa da forja rodar. Isso não escala: achar o próximo bug parecido depende de repetir esse
esforço manual. O pedido foi transformar isso numa rotina automática, sem precisar de alguém
acompanhando a tela.

## Decisão

Duas peças:

1. **`scripts/dogfood-forge.js`** — dispara uma forja real (`POST /api/agent/run`), faz polling em
   `GET /api/agent/status`, aprova cada gate sozinho (`POST /api/agent/approve`) até chegar num
   estado terminal (`completed`/`failed`/`cancelled`) ou estourar um teto de tempo (`--max-minutes`,
   que cancela a run em vez de deixar rodando pra sempre). Ao final, junta o resultado
   (`GET /api/runs/:id`) com a saúde operacional (`GET /api/ops/health`, ADR-033) e escreve um
   relatório em `backend/data/dogfood-reports/<timestamp>.{json,md}`. Sai com código 1 se a run
   falhou ou algum teste reprovou — pensado pra cron conseguir sinalizar problema sem alguém abrir
   o JSON. **Nunca inicia uma run se já existe uma em andamento** (checa `isExecuting`/
   `awaiting_approval` antes de disparar) — não deve atropelar trabalho real de alguém.

2. **Agendamento via `crontab` do macOS**, não via ferramenta de agendamento da sessão do Claude —
   decisão deliberada. A alternativa (agendar um prompt recorrente dentro da própria sessão do
   Claude Code) só existe enquanto aquele processo de terminal específico continua aberto, e expira
   sozinho depois de alguns dias — não é "agendar e esquecer" de verdade. Um `crontab` de usuário
   roda independente de qualquer sessão do Claude, sobrevive a reinícios do Mac (contanto que o
   usuário faça login) e não expira. Entrada instalada (semanal, segunda 6h):

   ```
   PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
   0 6 * * 1 cd /Users/clemiltonsilva/Documents/dev/ForjaIA && npm run service:start >> backend/data/dogfood.log 2>&1 && npm run dogfood >> backend/data/dogfood.log 2>&1
   ```

   `npm run service:start` (`scripts/forja-service.js`) é idempotente — só sobe o serviço se ele
   ainda não estiver saudável — então o cron pode rodar mesmo se o Mac tiver reiniciado ou o
   serviço tiver caído desde a última semana.

## Verificação ao vivo

- Rodei o script contra a API real (não mock) enquanto uma run de sessão anterior estava parada em
  `awaiting_approval`: o script recusou iniciar (`exit 2`, mensagem clara), confirmando que a
  checagem de "já existe run em andamento" funciona contra estado real, não só em teoria.
- Subi o serviço de produção real com `npm run service:start` (o mesmo comando que o cron vai
  chamar) e confirmei health check OK antes de instalar o crontab.
- Instalei a entrada com `crontab <arquivo>` e confirmei com `crontab -l` que ficou exatamente como
  esperado.
- Não rodei uma forja completa de ponta a ponta neste ADR (custo real de tempo/LLM não trivial,
  já validado exaustivamente nas sessões dos ADR-030/034) — os três endpoints que o script usa
  (`/api/agent/run`, `/api/agent/status`, `/api/agent/approve`, `/api/agent/cancel`,
  `/api/runs/:id`, `/api/ops/health`) já são exercitados por `httpIntegration.test.js` e pela
  própria sessão de dogfooding ao vivo do ADR-034.

## Consequências

- **Custo real recorrente**: cada rodada semanal dispara uma forja completa de verdade (LLM real,
  possivelmente Docker). Isso é intencional (é o ponto do dogfooding), mas é gasto de crédito de
  API toda semana, não só quando alguém decide rodar manualmente.
- **Depende de o Mac estar ligado e o usuário logado** às 6h de segunda — `cron` de usuário não
  roda com a máquina desligada/hibernada, nem antes do primeiro login. Não é um agendamento
  garantido tipo servidor sempre-ligado; é o melhor que dá pra fazer numa máquina de
  desenvolvimento local.
- macOS pode pedir permissão (Full Disk Access / Automação) pro processo `cron` na primeira vez que
  ele tenta rodar — se a rotina não gerar log nenhum na primeira segunda, checar
  Ajustes do Sistema → Privacidade e Segurança.
- O relatório fica só em arquivo local (`backend/data/dogfood-reports/`, já coberto pelo
  `.gitignore` de `backend/data/`) — ninguém é notificado ativamente de um resultado ruim; revisar
  o relatório continua sendo uma ação manual (abrir o `.md` mais recente). Uma evolução natural
  seria notificar (Slack/e-mail) quando `exit code !== 0`, mas fica fora do escopo deste ADR.
- Pra desativar: `crontab -e` e remover a linha, ou `crontab -r` pra limpar tudo (cuidado: remove
  qualquer outra entrada de crontab do usuário, não só esta).
