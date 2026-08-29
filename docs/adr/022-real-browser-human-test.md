# ADR-022 — Teste humano com navegador real (Playwright), fechando o gap do ADR-014

**Status:** Aceito

## Contexto

Pedido do usuário, depois de uma conversa sobre o que falta pra confiar de verdade no ForjaIA: dos
4 pontos levantados, o de maior impacto no propósito central ("forjar software que funciona de
verdade") era o teste humano em `agent/human.js` nunca ter testado como humano de verdade — desde o
ADR-014, ele só faz sondagem HTTP heurística (`fetch`, olha status/JSON), sem nenhuma automação de
UI real, admitido explicitamente como lacuna conhecida na época ("sem ferramenta de automação de UI
nativa disponível no ambiente").

Esse teste por HTTP tem um ponto cego estrutural: uma SPA pode devolver HTTP 200 em toda rota e no
`GET /` e ainda assim renderizar completamente em branco na tela (erro de bundle JS, root da SPA não
montando, etc.) — nenhuma dessas checagens por status pega isso. Só abrindo num navegador de verdade
esse tipo de falha aparece.

## Decisão

**Novo módulo** (`lib/browserCheck.js`, `runBrowserCheck`): abre `deployUrl` num Chromium headless
real via Playwright (`npm install playwright` + `npx playwright install chromium`, instalado nesta
sessão), e:
1. Navega até a página, espera carregar.
2. Confirma que o `<body>` renderizado tem conteúdo visível — página em branco vira achado
   `UX-BLANK-PAGE` severidade CRITICAL.
3. Captura erro de console do navegador e requisição 5xx durante o carregamento — algo que o teste
   HTTP por `fetch` isolado nunca veria (fetch não executa o JS da página, não dispara os mesmos
   efeitos colaterais que um carregamento real de browser dispara).
4. Se `discoverSurface` já tiver extraído algum botão do HTML (`summarizeHtml`, reaproveitado —
   nada novo aqui), clica nele de verdade (`page.getByText(...).click()`) e tira um screenshot
   antes/depois — prova que o botão não só EXISTE no markup, mas responde a interação real.
5. Screenshots vão pra `<projeto>/_reports/screenshots/`, mesmo padrão de diretório que
   `agent/reporter.js` já usa pros PDFs (`ensureReportsDir`).

**Degrada graciosamente**: `checkPlaywrightAvailable()` — sem Playwright instalado, o achado é
pulado (`available: false, skippedReason: ...`) sem bloquear o teste humano por HTTP, mesmo padrão
já estabelecido pra ferramenta externa opcional (Semgrep no ADR-021, Mac Catalyst no ADR-018).

**Integração em `agent/human.js`**: roda logo depois do loop de passos HTTP e antes da revisão
sênior — os achados do browser check entram na MESMA lista `issues` que já alimenta `finalPassed`,
então um `UX-BLANK-PAGE` (CRITICAL) já reprova a run pela lógica existente, sem precisar de uma
condição nova. O resumo do browser check também vai no payload que a revisão sênior (LLM) vê, pra
ela poder comentar sobre isso no `summary`. O relatório final ganha um campo `browserCheck` com
`title`/`clickedButton`/caminho dos screenshots, pro relatório/UI poder mostrar depois.

## Consequências

- **Achado real durante a implementação, não relacionado ao código em si**: o primeiro teste de
  integração falhou — clicar num botão com texto "Começar" nunca resolvia, timeout. Investigando:
  o servidor de teste fixture não declarava `charset=utf-8` no `Content-Type`; sem isso, o Chromium
  decodifica o HTML como Latin-1 por padrão, e "Começar" (UTF-8: `\xc3\xa7`) virava "ComeÃ§ar" na
  árvore renderizada — o seletor por texto nunca batia. Não é bug em `browserCheck.js`; é um lembrete
  de que texto não-ASCII em HTML sem charset explícito quebra decodificação no navegador — corrigido
  no fixture de teste (`text/html; charset=utf-8`), documentado aqui porque é o tipo de coisa que
  reaparece se um projeto forjado também esquecer o charset.
- **Testado contra um navegador real, não mockado**: os testes de `browserCheck.js` rodam Chromium
  de verdade contra um servidor HTTP real (não simulam o Playwright) — confirmam clique real,
  screenshot real gravado em disco (`fs.existsSync` + tamanho > 0), e detecção real de página em
  branco. Um teste de integração em `agent/human.js` prova o caso mais importante: uma run com TODOS
  os passos HTTP passando ainda é reprovada quando a página renderiza em branco — o cenário exato
  que o teste antigo (só HTTP) nunca conseguiria pegar.
- Tempo de execução do teste humano sobe (lançar Chromium leva ~150-300ms + navegação) — aceito,
  é o preço de testar de verdade em vez de só simular.
- `playwright`/Chromium é uma dependência nova e pesada (binário de browser, dezenas de MB) — só
  afeta o estágio de teste humano; nenhum outro caminho do pipeline depende disso.
- Continua sem cobrir mobile (Simulador iOS) — esse gap específico do ADR-014 permanece: Playwright
  automatiza navegador, não o Simulador nativo do iOS. Fora de escopo deste ADR.
