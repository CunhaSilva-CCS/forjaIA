# ADR-029 — Teste humano real no Simulador via Appium/XCUITest

**Status:** Aceito

## Contexto

`humanStage.js` pulava incondicionalmente o teste humano pra projetos mobile Expo/RN desde o
ADR-014, com um comentário já documentando isso como lacuna conhecida: "sem uma ferramenta de
automação de UI nativa disponível". Era o equivalente mobile do que o ADR-022 já tinha fechado pro
lado web (Playwright/navegador real complementando o teste HTTP).

Levantamento de viabilidade antes de implementar: a máquina tem `xcodebuild`/`xcrun simctl`
funcionais e Simuladores de iPhone disponíveis (confirmado rodando os comandos de verdade). Na
implementação inicial deste ADR, não havia Appium/driver `xcuitest` instalados, e configurar esse
ambiente ao vivo (driver + build do WebDriverAgent + um app Expo de demonstração) parecia fora do
escopo prático da sessão — mas o usuário pediu explicitamente pra tentar mesmo assim, e valeu a
pena: ver "Verificação ao vivo" abaixo, que substitui o que era originalmente uma ressalva de "não
testado" por achados reais que só apareceram testando contra o ambiente de verdade.

## Decisão

**`lib/mobileHumanTest.js`** (novo, espelha `lib/browserCheck.js` do ADR-022): fala HTTP direto com
o protocolo WebDriver do Appium (`POST /session`, `GET /session/:id/screenshot`,
`GET /session/:id/source`, `POST /session/:id/element` + `/click`, `DELETE /session/:id`) —
**sem nenhum SDK cliente novo**. Cheguei a instalar `webdriverio`/`webdriver` e rodar `npm audit`:
ambos arrastam `@wdio/utils` → `@puppeteer/browsers` → `extract-zip` (path traversal, CVE HIGH) e
`deepmerge-ts` (stack exhaustion, CVE HIGH) só pela funcionalidade de auto-download de navegador,
que este uso (conectar a um Appium já rodando) nunca invocaria. Desinstalei os dois — Appium expõe
uma API REST simples o bastante pra não justificar herdar esse risco; `backend/package.json` não
ganhou nenhuma dependência nova.

- `checkAppiumAvailable()`: `GET /status` no servidor Appium (`FORJA_APPIUM_URL`, default
  `http://127.0.0.1:4723`) — mesmo papel de `checkPlaywrightAvailable`.
- `runMobileHumanTest({ simulatorUdid, bundleId, runConfig, orchestrator })`: abre sessão XCUITest
  contra o app já instalado, tira screenshot inicial, lê a árvore de acessibilidade — vazia vira
  `UX-MOBILE-BLANK-SCREEN` CRITICAL (equivalente mobile do `UX-BLANK-PAGE` do browserCheck) —,
  procura um rótulo plausível de CTA (mesmo regex do lado web) e toca nele de verdade via
  `-ios predicate string`, screenshot de depois. Degrada graciosamente (`available:false, ok:true`)
  sem servidor Appium alcançável, sem `simulatorUdid`/`bundleId`, ou se a sessão falhar
  (`UX-MOBILE-SESSION-FAILED`, HIGH) — nunca bloqueia o pipeline por falta de ferramenta.
- **`lib/mobileDeploy.js`**: `deployToSimulator` ganhou `resolveBundleId(projectDir)` — lê
  `PRODUCT_BUNDLE_IDENTIFIER` do `.xcodeproj/project.pbxproj` gerado pelo prebuild do
  `expo run:ios` (a fonte da verdade do que realmente foi instalado), caindo pro
  `app.json`/`expo.ios.bundleIdentifier` só se o pbxproj não existir ainda.
- **`agent/stages/deployStage.js`**: persiste `deployResult.targets` (que já incluía
  `simulatorUdid`/`bundleId` desde o ADR-018, só nunca tinha sido guardado em lugar nenhum) em
  `orchestrator.currentTask.deployTargets` / `savedConfig.deployTargets` — sem isso,
  `humanStage.js` não teria como saber qual Simulador/app abrir. `orchestrator.js` ganhou a
  restauração correspondente em `restorePendingApproval` (mesmo padrão de `deployUrl`/
  `humanReport`).
- **`agent/stages/humanStage.js`**: o branch mobile agora tenta `runMobileHumanTest` de verdade em
  vez de pular incondicionalmente; sem Appium disponível, cai exatamente no mesmo comportamento de
  skip explícito de antes (não é regressão pra quem não tem o toolchain instalado).

## Verificação ao vivo (Appium + XCUITest reais, não só mock)

Instalei `appium` + driver `xcuitest` numa pasta descartável fora do projeto (`npm install
appium` sozinho audita limpo — 0 vulnerabilidades; confirma que a árvore suja era mesmo só de
`webdriverio`/`webdriver`, não do Appium em si), subi o servidor, buildei e instalei um app Expo
real (o SecPass, um projeto já existente no workspace) num Simulador booted de verdade, e rodei
`runMobileHumanTest` — depois `humanStage.run()` inteiro — contra essa sessão real. Dois bugs
reais só apareceram nessa verificação, nenhum dos dois seria pego por teste unitário/mock:

1. **Timeout curto demais pra criação de sessão**: a primeira sessão contra um UDID dispara um
   build nativo do WebDriverAgent via `xcodebuild` (confirmado no log do Appium) — meu timeout
   único de 20s (bom pra screenshot/source/click de rotina) abortava a criação de sessão antes
   dela terminar. Corrigido com um `SESSION_TIMEOUT_MS` separado (180s, configurável via
   `FORJA_APPIUM_SESSION_TIMEOUT_MS`) só pra `POST /session`; comandos de rotina continuam com o
   timeout curto.
2. **`accessible="true"` sozinho não distingue botão de texto estático**: minha primeira correção
   assumiu que `accessible="true"` bastava pra achar um elemento tocável. Errado — o iOS expõe o
   MESMO texto estático duas vezes na árvore (uma com `accessible="false"`, outra com
   `accessible="true"` — a representação de navegação do VoiceOver), então um título como "Entrar
   no SecPass" batia no regex de CTA e o "toque" virava no-op (screenshots antes/depois
   idênticos — só percebi comparando as imagens de verdade). Descobri também que botões
   Pressable/TouchableOpacity do React Native viram `XCUIElementTypeOther` no iOS, não
   `XCUIElementTypeButton` — filtrar por tipo de elemento sozinho também erraria. A correção final
   (`extractTappableLabels`) combina os dois sinais: tipo que não é claramente não-interativo
   (exclui StaticText/Image/TextField/SecureTextField/Application/ScrollView/Window) **e**
   `accessible="true"` **e** `enabled="true"`. Confirmado corrigido tocando de verdade em "Criar
   conta" (o botão real) e vendo a mudança de estado real na tela ("Informe email e senha para
   entrar." apareceu após o toque — screenshots antes/depois diferentes desta vez).

Depois da correção, rodei de novo: sessão abriu em ~5s (WDA já compilado e em cache), achou e tocou
no botão certo, screenshots reais salvos e comparados visualmente, e — o teste mais importante —
`humanStage.run()` completo (não só a lib isolada) processou o resultado real e pausou em
`prodReady` com a mensagem certa. Essa é a primeira vez neste projeto que o caminho mobile do
`humanStage.js` roda de ponta a ponta contra Appium/XCUITest de verdade, não mock.

## Consequências

- Backend: 289/289. `mobileHumanTest.test.js` (11 testes) roda contra um servidor HTTP fake que
  fala o protocolo Appium de verdade — inclui uma regressão dedicada pro achado do
  `accessible="true"` (fixture com o mesmo texto duplicado que a árvore real tinha), sessão sem
  elementos vira CRITICAL de verdade, clique funciona de ponta a ponta, screenshot é um PNG de
  verdade escrito em disco (`fs.existsSync` + tamanho > 0), falha de sessão vira HIGH sem travar. 3
  testes novos em `orchestratorStages.test.js` cobrem os três desfechos do branch mobile de
  `humanStage.js`. 3 testes novos em `mobileSupport.test.js` cobrem `resolveBundleId` (pbxproj >
  app.json > null) — inclusive contra o `.pbxproj` real do app usado na verificação ao vivo.
- `FORJA_APPIUM_URL`/`FORJA_APPIUM_SESSION_TIMEOUT_MS`/`FORJA_APPIUM_TIMEOUT_MS` são opt-in por env
  var — sem Appium instalado, o comportamento observável é idêntico ao skip explícito de antes
  deste ADR.
- O que a verificação NÃO cobriu: apps mobile fora do padrão Expo/RN comum (ex.: WebView
  embutida, apps com Button nativo de verdade em vez de Pressable) podem expor a árvore de
  acessibilidade de outro jeito; `extractTappableLabels` foi calibrado contra o padrão real
  observado (RN + Pressable/TouchableOpacity), não contra todo padrão possível de app iOS.
