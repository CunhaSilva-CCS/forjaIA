# ADR-004 — TypeScript strict mode e eliminação de `any`

**Status:** Aceito

## Contexto

`frontend/tsconfig.app.json` não tinha `strict: true`, e 20 usos de `any` explícito se concentravam exatamente nos pontos de maior variabilidade de dados: os payloads do WebSocket (`handleWsMessage`), o estado de time/board (`teamInfo`, `teamBoard`), e as respostas de `api.run`/`api.validate`. Esses eram justamente os pontos onde um erro de forma de dado — um campo renomeado no backend, um `undefined` não tratado — mais provavelmente quebraria silenciosamente em produção sem o compilador avisar.

## Decisão

1. Ligar `strict: true`. Compilou limpo sem exigir correções — o código já não dependia de `any` implícito nem tinha violações de null-safety escondidas.
2. Modelar os payloads reais em `types/agent.ts`: `Task`, `TaskConfig`, `HumanReport`, `RunEvent`, `TeamMember`, `TeamBoardRun`, `TeamInfo`. `RunSummary.events` foi corrigido de `LogLine[]` (forma normalizada do frontend) para `RunEvent[]` (forma bruta do backend, com `created_at` em vez de `timestamp`) — o tipo antigo estava simplesmente errado, mascarado pelo `any` no map que normalizava o formato.
3. `handleWsMessage(event, data)` recebe `data: unknown` no boundary — não um tipo único guarda-chuva. Cada `case` do switch faz `const payload = data as <TipoExato>` para o formato específico daquele evento. Essa decisão foi deliberada: os payloads de `tokens-updated` (um `TokenStats` cru) e de `task-started` (um `Task`) têm campos que colidem em tipo (`prompt: number` vs `prompt: string`) se forçados numa interface só — um cast por branch é mais correto que uma interface mentirosa tentando cobrir todos os formatos.

## Consequências

- Zero `any` explícito remanescente em `frontend/src` (fora de arquivos de teste).
- `services/ws.ts` agora tipa o boundary do WebSocket como `unknown`, forçando quem consome a decidir a forma — a alternativa (`any`) deixava esse boundary despropositadamente permissivo.
- Validado em runtime, não só estaticamente: um pipeline real (LLM de verdade) foi rodado via Playwright depois da mudança, exercitando `sync-state`, `task-started`, `agent-log`, `agent-active`, `agent-finished`, `tokens-updated`, `task-awaiting-approval` e `task-resumed` — zero erro de console.
- Trade-off aceito: os casts por branch (`data as Task`, `data as TokenStats` etc.) não são verificados em runtime — um payload malformado do backend ainda pode passar sem erro do TypeScript. Isso é uma limitação estrutural de tipar um boundary de WebSocket sem um validador runtime (zod/io-ts) do lado do cliente; não foi adicionado aqui por estar fora do escopo desta mudança.
