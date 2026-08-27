# ADR-002 — Decompor App.tsx e useForjaApp.ts

**Status:** Aceito

## Contexto

`frontend/src/App.tsx` era um único componente `Dashboard()` de 994 linhas renderizando header, pipeline, 9 abas e 4 painéis laterais. `frontend/src/hooks/useForjaApp.ts` era um único hook de 985 linhas concentrando todo o estado da aplicação (~50 `useState`), a lógica do WebSocket, navegação de pastas, controle de serviço, e todos os handlers de ação. Zero testes de frontend existiam; a lógica de estado mais complexa (`deriveAgentStates`, uma state machine de ~90 linhas reconstruindo o estado visual dos agentes a partir de um snapshot de task) estava embutida no hook sem cobertura.

## Decisão

**App.tsx** virou um shell de 47 linhas que monta 15 componentes novos: `AppHeader`, `OrderPanel`, `PipelinePanel`, `WorkspaceTabs` (+ 9 componentes de aba em `components/tabs/`), `DeployCard`, `TestsCard`, `LlmTokensCard`, `RulesCard`, `FolderBrowserModal`. Cada componente recebe o objeto `s` (retorno completo de `useForjaApp()`) como prop única — deliberadamente não foi feita uma tipagem de props granular por componente, para manter a extração mecânica e de baixo risco (nenhuma mudança de comportamento, só de localização do JSX).

**useForjaApp.ts** teve `deriveAgentStates` extraída para `utils/deriveAgentStates.ts` como função pura testável, e dois blocos de estado genuinamente autocontidos (navegador de pastas, controle de serviço) viraram hooks próprios (`useFolderBrowser`, `useServiceControl`), recebendo como parâmetro só o que realmente precisam de fora (`targetPath`/`showToast`, e `showToast`/`refreshMeta`, respectivamente).

## Consequências

- `App.tsx`: 994 → 47 linhas. `useForjaApp.ts`: 985 → 770 linhas.
- `deriveAgentStates` ganhou 15 testes unitários cobrindo os ramos de decisão (modo forge/validate, awaiting_approval, completed, userFix, security issues, deployUrl, humanReport) — zero cobertura antes.
- Validação não ficou só no `tsc`/build: o fluxo foi exercitado ao vivo via Playwright contra um pipeline real (LLM de verdade, não mock), navegando pelas 9 abas e pelo modal de pastas, sem erros de console.
- Trade-off aceito conscientemente: passar `s: AppState` inteiro como prop único é mais simples de extrair e revisar, mas cada componente tem acesso a mais estado do que estritamente usa. Uma tipagem de props granular por componente é um refactor futuro razoável, não feito aqui para não aumentar o escopo/risco da extração inicial.
