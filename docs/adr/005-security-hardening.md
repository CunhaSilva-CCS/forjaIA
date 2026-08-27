# ADR-005 — Endurecimento de segurança pontual

**Status:** Aceito

## Contexto

Um audit inicial do projeto encontrou cinco pontos de severidade baixa (nenhum crítico, mas todos corrigíveis a custo baixo): comparação de token do admin não era constant-time (`token === config.apiToken`); `GET /api/team` expunha os tokens de bootstrap de lead/qa/sre para qualquer membro autenticado, não só admin; `scripts/check-local-prod.js` e `scripts/forja-service.js` passavam variáveis de ambiente pra dentro de `execSync` com string interpolada (formato de shell injection, mesmo sem vetor de exploração ativo no momento); um bug real (`force || true`) fazia `forja-service.js stop()` sempre forçar SIGKILL, ignorando o parâmetro `force`; e os links de export/relatório PDF no frontend embutiam o token de acesso na query string da URL, exposto em histórico de navegador e logs de proxy.

## Decisão

- `lib/team.js`: hash SHA-256 dos dois lados + `crypto.timingSafeEqual` em vez de comparação direta de string.
- `server.js`: `GET /api/team` só inclui `bootstrapTokens` na resposta quando `req.member.isAdmin`.
- `scripts/*.js`: `execSync` com string interpolada trocado por `execFileSync('curl'/'lsof', [...args])` — a variável de ambiente vira um argv literal, nunca passa por um shell.
- `scripts/forja-service.js`: `if (force || true)` corrigido para `if (force)`.
- `frontend/services/api.ts`: `exportUrl`/`reportPdfUrl` (que geravam `<a href>` com `?token=`) viraram `downloadExport`/`downloadReportPdf` — fazem `fetch` com `Authorization: Bearer`, baixam como Blob, disparam o download via link de objeto temporário. O token nunca aparece numa URL visível.
- Adicionalmente (não no audit original, mas na mesma categoria): `helmet` para headers de segurança HTTP, `express-rate-limit` com um limite geral em `/api/*` e um limite mais apertado que só conta tentativas de auth com erro (`skipSuccessfulRequests`), e um cap de 25 versões por (run, arquivo) em `run_file_versions` — a tabela crescia sem limite a cada ciclo de cura/correção dentro de uma run longa.

## Consequências

- Todos os itens têm teste de regressão dedicado (`phase1Squad.test.js` para o timing-safe compare, `httpIntegration.test.js` para o `/api/team` admin-vs-membro rodando contra um servidor HTTP real, `fileVersionsPurge.test.js` para o cap).
- Modelo de ameaça permanece o mesmo assumido pelo projeto: ferramenta local self-hosted, bind em loopback por padrão. Nenhum desses itens era crítico nesse modelo — todos se tornam mais relevantes se `FORJA_ALLOW_PUBLIC_BIND=true` for usado.
- Trade-off aceito no rate limiting: os limites (600/5min geral, 30/15min para tentativas de auth com erro) foram escolhidos por estimativa de uso normal da UI (polling de status a cada 15s, etc.), não por medição de carga real — podem precisar de ajuste se o padrão de uso real divergir.
