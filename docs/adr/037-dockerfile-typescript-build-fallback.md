# ADR-037 — Build do sandbox travava pra sempre num projeto TypeScript sem tsconfig.json

**Status:** Aceito

## Contexto

Achado ao vivo, numa run real acompanhada na tela: uma ordem de "RAG profissional" ficou presa
repetindo a etapa "Carga e caos (DevOps)" e falhando sempre da mesma forma, mesmo depois de aprovar
de novo várias vezes. O Codificador tinha gerado um `package.json` com `"scripts": {"build": "tsc"}`
mas **nunca escreveu um `tsconfig.json`**.

O Dockerfile da sandbox (`lib/dockerBuild.js`) roda `RUN npm run build || (test -f tsconfig.json &&
npx tsc)`. Sem `tsconfig.json`: `npm run build` (= `tsc` puro) não acha configuração nem arquivo de
entrada e, em vez de um erro de compilação, o TypeScript 5.x imprime a **ajuda de linha de comando**
inteira (`--types`, `--esModuleInterop`, etc.) e sai com código 1 — o log de erro parecia um
comando mal formado, não "falta um arquivo". O fallback também falhava, porque `test -f
tsconfig.json` dá falso quando o arquivo não existe, então `npx tsc` nunca chegava a rodar.

Pior: diferente do ciclo QA→Segurança→Depurador→Curador (que tem retry automático com correção),
uma falha de build do Docker na etapa DevOps não aciona nenhum ciclo de cura — só re-pausa a MESMA
etapa esperando aprovação humana. Aprovar de novo repete o build idêntico, que falha do mesmo jeito
pra sempre. Foi exatamente isso que apareceu na tela: 3+ tentativas idênticas em sequência.

## Decisão

Duas mudanças em `lib/dockerBuild.js`:

1. **`ensureTsconfig(dir)`** — quando `needsCompile()` decide que o projeto precisa de build mas não
   existe `tsconfig.json` no diretório, escreve um `tsconfig.json` padrão sensato (`module`/
   `moduleResolution` ajustados conforme `package.json.type === "module"` ou não) diretamente no
   diretório da sandbox, ANTES do `docker build` rodar — chamado de dentro de `buildDockerfile()`,
   que já tem acesso de escrita a esse diretório real (mesmo padrão de "completar artefato ausente"
   que `lib/productionChecklist.js` já usa pra Dockerfile/.env.example).

2. **`needsCompile()` não força mais um build step quando o `start` já roda TypeScript direto via
   `tsx`/`ts-node`** — esse tipo de projeto não depende de `dist/` nenhum; forçar `tsc` aí é trabalho
   desnecessário e, coincidentemente, é exatamente o tipo de projeto que tende a nunca ter um
   `tsconfig.json` de verdade (nunca precisou de um pra rodar).

**Regressão pega na mesma verificação ao vivo, antes de declarar concluído**: a mudança #2, isolada,
quebrou a run de verdade de um jeito diferente — o container buildava mas saía na hora (`exit 127
sh: tsx: not found`), porque `needsCompile()` também controlava se `npm install` incluía
devDependencies (`--omit=dev` quando `compile` é falso), e `tsx` é uma devDependency. "Precisa
compilar" e "precisa de devDependencies instaladas" não são a mesma pergunta — projeto tsx não
compila nada, mas o próprio `tsx` só existe se as dev deps forem instaladas. Corrigido com uma
terceira função, `needsDevDependencies(dir, start)` = `needsCompile(...) || usesTsRuntime(...)`,
usada só pra decidir `npm install` vs `npm install --omit=dev`, mantendo `needsCompile()` livre pra
só decidir se gera o build step + tsconfig.

## Verificação ao vivo

Corrigi e verifiquei contra a MESMA run real que estava travada na tela (`1788026424125-qpy8357h`),
reiniciando o serviço e reaprovando a etapa DevOps pendente a cada rodada — não um fixture:

1. Antes da correção: build do Docker falhava sempre com o dump de ajuda do `tsc` (confirmado via
   `GET /api/runs/:id`, texto exato do erro).
2. Depois da correção #1 (tsconfig automático) sozinha: o build passou, mas o container morreu na
   hora com `sh: 1: tsx: not found` (exit 127) — a regressão descrita acima, pega ao vivo antes de
   reportar sucesso.
3. Depois da correção #2 (`needsDevDependencies`): reaprovei a etapa DevOps de novo e desta vez ela
   **completou de verdade** — "Carga/caos ok (sucesso 97%). Aprove para o deploy local." A run que
   estava presa num loop infinito de aprovação manual seguiu adiante.

## Consequências

- Backend: +9 testes novos em `dockerBuild.test.js` (achado real do tsconfig ausente, achado real da
  regressão de devDependencies, e os casos de não-regressão de `ts-node`/projeto JS simples/projeto
  que genuinamente precisa compilar).
- Não resolve o problema estrutural mais amplo: uma falha de build do Docker na etapa DevOps ainda
  não aciona nenhum ciclo automático de diagnóstico/correção como QA/Segurança têm — só evita que
  ESSA causa específica (tsconfig ausente, tsx sem devDependencies) trave a run pra sempre. Outras
  causas de falha de build do Docker na sandbox continuam exigindo intervenção humana pra
  diagnosticar, sem um Depurador/Curador dedicado pra essa etapa.
