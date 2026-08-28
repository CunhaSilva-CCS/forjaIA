# ADR-014 — Suporte a projetos mobile Expo/React Native (QA nativo + deploy no Simulador)

**Status:** Aceito

## Contexto

O pipeline inteiro (QA via HTTP, DAST, Dockerfile, deploy em container/porta, checklist de
produção) pressupõe um serviço web. Pedido do usuário: rodar o ForjaIA de ponta a ponta contra um
projeto real que não é web — `secPass` (Expo/React Native, iOS/Android, sem servidor HTTP, cofre
local criptografado). Sem adaptação, cada etapa web-específica falha ou produz achados falsos
(ex.: DAST "indisponível" sempre, checklist de produção pedindo Dockerfile que nunca vai existir).

## Decisão

**Detecção**: `lib/projectType.js` — `detectProjectType(files)` lê `package.json` e retorna
`'mobile-expo'` se houver dependência `expo` ou `react-native`, senão `'web'` (default seguro:
qualquer projeto sem `package.json` parseável cai em `'web'`, comportamento inalterado).

**QA** (`agent/qa.js`): projeto mobile roda a suíte de testes real do próprio projeto (`npx jest
--json`, via `lib/mobileTest.js`) em vez das suítes HTTP hardcoded (auth/crud/rag). Resultado
convertido pro mesmo formato `{ passed, tests: [...] }` — o resto do pipeline (relatório, ADR-012)
não precisa saber a diferença. Só funciona em modo "validar projeto existente" (`sourcePath`
apontando pro projeto já em disco com `node_modules` instalado) — modo "forge" do zero geraria
arquivos sem instalação, sem onde rodar Jest ainda; nesse caso pula com aviso explícito.

**Segurança** (`agent/security.js`): DAST (pentest ativo via HTTP) não é sequer tentado em projeto
mobile — "não se aplica" é tratado como neutro, não como achado `SEC-DAST-UNAVAILABLE` (antes
disso, insistir teria criado um loop de Cura sem nada real pra corrigir). SAST (análise estática +
scanner de segredos, ADR-011) continua rodando normal — código é código, independente da
plataforma.

**Carga/caos** (`devopsLoadStage.js`): pulado inteiro pra projeto mobile (não há servidor HTTP pra
sobrecarregar) — vai direto pro deploy.

**Deploy** (`agent/devops.js` → `deployMobile`, novo; `lib/mobileDeploy.js`, novo): sem
container/porta — o equivalente real de "deploy" pra um app mobile é compilar e instalar no
Simulador de iPhone. `pickSimulator()` escolhe um simulador iOS disponível (prioriza um já
bootado); `deployToSimulator()` roda `npx expo run:ios --device <udid>`, visível na tela do
usuário (o Simulador é uma janela real do macOS). Resultado tem o mesmo shape de
`lib/deployRuntime.js` (`{ type, url, ... }`) com `url: null` — o resto do pipeline usa a ausência
de URL como sinal de "sem HTTP aplicável", não como erro.

**Humano** (`humanStage.js`): sem URL HTTP, o teste humano automatizado (que usa `fetch`) não se
aplica. Sem uma ferramenta de automação de UI nativa disponível (não há Appium/XCUITest no
ambiente), o estágio pula com o motivo explícito no relatório (`humanReport.skipped: true`) em vez
de travar ou fingir cobertura que não existe.

**Checklist de produção** (`lib/productionChecklist.js`): mobile retorna `ready: true` direto, sem
rodar os checks web (Dockerfile, PORT, `/health`) — a prova real de que o app funciona já
aconteceu no deploy (instalado e aberto de verdade no Simulador).

## Consequências

- Nenhuma mudança de comportamento para projetos web — cada guard checa `detectProjectType`
  primeiro e só desvia se for `'mobile-expo'`; o caminho `'web'` é bit-a-bit o código de antes.
- QA nativo mobile só funciona hoje em modo "validar projeto existente" — suporte a gerar um app
  mobile do zero (`forge`) e rodar Jest nele exigiria um passo de `npm install` que não existe
  ainda; fica como lacuna conhecida, não coberta por este ADR.
- Teste humano automatizado real (tocar na UI do app dentro do Simulador) não existe — precisaria
  de uma ferramenta de automação nativa (Appium/XCUITest) que não está disponível hoje. O
  pipeline é honesto sobre essa lacuna (`skipped: true` com motivo) em vez de simular cobertura.
- `expo run:ios` é uma compilação nativa real (minutos, não segundos) — bem mais lento que o
  deploy Docker/processo local do caminho web. Aceito: é o preço de rodar de verdade no Simulador.

## Achados reais durante a validação ao vivo (secPass)

Rodar o pipeline de ponta a ponta contra um projeto real (não um fixture de teste) achou três bugs
que nenhum teste unitário tinha pego:

1. **Falso positivo de segredo em fixture de teste** (`agent/security.js` + `lib/secretScan.js`,
   ver ADR-011 atualizado) — tanto o regex original de segredo quanto o novo scanner batiam em
   `const password = "Abc!2345"` dentro de `__tests__/*.test.js` (fixture normal, não segredo) e
   numa constante `VAULT_SECRET_REQUIRED` cujo NOME continha "secret" mas o VALOR era uma frase de
   erro. Corrigido: detectores heurísticos por nome ignoram arquivo de teste; valor capturado
   precisa não ter espaço (segredo de verdade não é uma frase); regex de objeto-literal ganhou
   lookbehind pra não casar ternário/member access como se fosse `chave: valor`.
2. **`healer.js` quebrava a cura inteira por um item malformado** — o LLM (Ollama, via fallback)
   devolveu um arquivo sem `path` no meio de uma resposta válida; sem validar, isso virava chave
   `undefined` num `Map` e quebrava `path.basename(undefined)` mais adiante, quando o resto da
   resposta estava correto. Corrigido: filtra itens sem `path` string válido antes de processar,
   só falha se sobrar zero arquivos válidos.
3. **`expo run:ios` nunca fecha sozinho** (`lib/mobileDeploy.js`) — ao contrário de um build Docker,
   ele vira o servidor Metro (bundler) e fica rodando pra sempre; esperar o processo fechar
   (`child.on('close')`) travava a Promise para sempre, mesmo com o app já instalado e rodando na
   tela. Corrigido: "sucesso" passa a ser detectado por uma frase conhecida da CLI ou por um
   período sem saída nova (heurística, não depende de adivinhar o texto exato de uma versão do
   Expo), com o processo seguindo vivo depois. Um segundo problema no mesmo lugar: mesmo com
   `detached: true`, o stdio do filho ainda estava canalizado (`pipe`) pro processo pai — quando o
   servidor do ForjaIA é reiniciado (comum em desenvolvimento), o cano quebra e derruba o Metro
   junto. Corrigido: stdio do filho vai para um arquivo real (`fs.openSync` + `stdio: [...]` com o
   descritor do arquivo), não para um pipe — padrão documentado do Node para processo filho
   sobreviver à morte do pai.
