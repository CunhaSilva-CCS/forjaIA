# ADR-025 — Papel "viewer" + fecha o RBAC não-enforced em run/cancel/relato

**Status:** Aceito

## Contexto

Quarto e último ponto da lista "o que falta pra confiar no ForjaIA": RBAC raso pra uso em equipe.
Investigando de verdade antes de mexer (não só repetir o que eu tinha dito antes de olhar o
código): o RBAC do ForjaIA é mais desenvolvido do que a frase original sugeria — `lib/rbac.js` já
tem `STAGE_ROLES` por etapa (`deploy`/`prodReady` já exigiam `admin`/`sre`/`lead` pra aprovar) e
`assertCanApprove` já é chamado de verdade dentro de `orchestrator.approveAndContinue`. O gate que
protege deploy/produção **já existia e já funcionava**.

O gap real, achado ao ler cada rota uma por uma:
- `canStartRun(member)` existia (`lib/rbac.js`) mas **nunca era chamado em lugar nenhum** —
  `/api/agent/run` e `/api/agent/validate` deixavam qualquer membro autenticado iniciar uma run
  (gasta LLM de verdade) sem checagem de papel alguma. Código de autorização escrito mas nunca
  ligado é pior que nenhum código: parece proteção, não protege nada.
- `/api/agent/cancel` não tinha **nenhuma** checagem de papel — qualquer membro autenticado podia
  cancelar a run de qualquer outra pessoa, incluindo um deploy de produção em andamento de outro
  membro.
- `/api/agent/user-report` (enfileira o Corretor, uma correção real) também não tinha checagem.

## Decisão

**Novo papel `viewer`** (`lib/rbac.js` — `ROLES`): só-leitura. Não entra em nenhum `STAGE_ROLES`
(nunca aprova nada — já verdadeiro antes, sem mudança), e agora também não inicia run, não
cancela, não relata problema ao Corretor. Continua podendo ver runs/histórico/relatórios/board da
equipe (rotas `GET` não tocadas — não precisam de mudança, já eram só-leitura).

**Três funções novas** (mesmo padrão de `canManageServices`, já existente): `canStartRun` corrigida
pra realmente excluir `viewer` (antes só checava `Boolean(member)`), `canCancelRun` e
`canReportIssue` novas. Todas seguem o mesmo critério simples — qualquer papel exceto `viewer` pode
— sem introduzir um conceito de "dono da run" (avaliado e descartado: adicionaria complexidade sem
pedido claro do usuário, e cancelar é uma ação de segurança, não a arriscada — a arriscada, aprovar
até produção, já é gated por `STAGE_ROLES`).

**Wiring** (`server.js`): as 4 rotas (`/api/agent/run`, `/api/agent/validate`, `/api/agent/cancel`,
`/api/agent/user-report`) ganharam a checagem no topo do handler, mesmo padrão de
`/api/services/:action` com `canManageServices` — `403` com mensagem clara antes de qualquer
processamento.

Criar um membro com papel `viewer` já funciona sem mudança na rota de criação
(`POST /api/team/members`, admin-only) — só precisava que `'viewer'` fosse um valor aceito por
`normalizeRole`, que agora é.

## Consequências

- 10 testes novos: `rbac.test.js` (funções puras — `canStartRun`/`canCancelRun`/`canReportIssue`
  excluindo viewer, permitindo os demais) e `rbacHttpGuards.test.js` (achado real contra o
  servidor HTTP de verdade — cria um membro `viewer` real via `team.create`, confirma 403 nas 4
  rotas, confirma que `member`/`admin` NÃO tomam 403 de RBAC, só de outra causa). Backend
  263/263.
- Nenhuma mudança de frontend — não existe formulário de criação de membro na UI ainda (só a rota
  de API, admin-only), então não há lista de papéis hardcoded pra atualizar. Fica como lacuna
  conhecida e já existente antes deste ADR, não criada por ele.
- Nenhuma mudança em `STAGE_ROLES`/`assertCanApprove` — já estavam corretos; este ADR fecha o gap
  que sobrava (iniciar/cancelar/relatar), não repete o que já funcionava.
