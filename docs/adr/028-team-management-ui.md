# ADR-028 — UI de gestão de equipe (criar e desativar membros)

**Status:** Aceito

## Contexto

A célula de produção (`lib/team.js`) já suportava criar (`team.create`) e desativar
(`team.deactivate`) membros desde antes deste ADR, mas só `create` tinha rota HTTP
(`POST /api/team/members`). `deactivate` nunca foi exposto — nenhuma rota chamava. A `TeamTab.tsx`
só listava membros; criar ou desativar exigia `curl` direto na API com o token de admin. Apontado
como lacuna real na rodada de auditoria funcional que também gerou os ADR-026/027.

## Decisão

- **Backend**: nova rota `POST /api/team/members/:id/deactivate` (`server.js`), admin-only (mesmo
  guard de `POST /api/team/members`), 404 se o id não existe ou é `admin` (o admin único derivado
  de `FORJA_API_TOKEN` não é um `team_members` de verdade — desativá-lo não faz sentido e quebraria
  o bootstrap).
- **Frontend**: `api.team.deactivateMember(id)` (`services/api.ts`); `useForjaApp.ts` ganha
  `refreshTeamInfo`, `createTeamMember`, `deactivateTeamMember` (mesmo padrão de toast +
  rebusca dos demais `refreshX`/handlers do hook). `TeamTab.tsx` ganha um formulário "Novo membro"
  (nome, papel, token com botão "Gerar" pra sugerir um token aleatório) e um botão "Desativar" por
  linha — ambos visíveis só quando `s.teamMe?.isAdmin`, espelhando o gate que a API já impõe
  (não é só estética: esconder o que o backend rejeitaria evita um 403 confuso pra quem não é
  admin).

## Consequências

- Backend: 272/272 (3 testes novos em `httpIntegration.test.js`: 403 pra não-admin, sucesso pra
  admin com o membro sumindo da listagem depois, 404 pra id inexistente e pro `admin`).
- Frontend: 143/143 (6 testes novos em `TeamTab.test.tsx`: form e botão escondidos pra não-admin,
  criação chama `createTeamMember` com os campos certos, botão desabilitado sem nome, desativação
  chama `deactivateTeamMember` com o id certo, botão "Gerar" troca o token, fila/gates de
  `teamBoard` continuam renderizando).
- Verificado ao vivo (não só teste automatizado): subi backend+frontend reais, criei "Carla Teste"
  via formulário, ela apareceu na lista com o token real gerado, cliquei "Desativar", ela sumiu —
  round-trip completo contra a API real, não mock.
- **Achado colateral, não corrigido aqui**: `.env` tem `CORS_ORIGIN=http://127.0.0.1:3001` fixo, o
  que quebra CORS pra qualquer acesso via `:5173` (`npm run dev`/`dev:stable`, que servem o
  frontend nessa porta). Um comentário no próprio `.env` já avisa disso ("ajuste CORS se
  precisar"), então é configuração deliberada de ambiente, não bug de código — fica registrado
  aqui porque me custou tempo de diagnóstico na verificação ao vivo deste ADR, não porque decidi
  mudar o `.env` do usuário sem pedir.
