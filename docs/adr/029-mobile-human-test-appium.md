# ADR-029 — Teste humano real no Simulador via Appium/XCUITest

**Status:** Aceito

## Contexto

`humanStage.js` pulava incondicionalmente o teste humano pra projetos mobile Expo/RN desde o
ADR-014, com um comentário já documentando isso como lacuna conhecida: "sem uma ferramenta de
automação de UI nativa disponível". Era o equivalente mobile do que o ADR-022 já tinha fechado pro
lado web (Playwright/navegador real complementando o teste HTTP).

Levantamento de viabilidade antes de implementar: a máquina tem `xcodebuild`/`xcrun simctl`
funcionais e Simuladores de iPhone disponíveis (confirmado rodando os comandos de verdade), mas
**não** tem um servidor Appium nem o driver `xcuitest` instalados — e o primeiro build do
WebDriverAgent (exigido pelo driver XCUITest) é um build nativo que tipicamente leva vários
minutos e precisa de um app Expo já instalado num Simulador booted pra ter algo a testar. Configurar
esse ambiente inteiro ao vivo (driver + WDA + um app Expo de demonstração) ficou fora do escopo
prático desta sessão — mesma honestidade sobre limitação de ambiente que o resto do projeto já
assume (ex.: helmet hallucination do ADR-026).

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

## Consequências

- Backend: 285/285. `mobileHumanTest.test.js` (7 testes) roda contra um servidor HTTP fake real que
  fala o protocolo Appium de verdade (não mocka a função inteira) — sessão sem elementos vira
  CRITICAL de verdade, clique em elemento encontrado por predicate string funciona de ponta a
  ponta, screenshot é um PNG de verdade escrito em disco e verificado (`fs.existsSync` +
  tamanho > 0), falha de sessão vira HIGH sem travar. 3 testes novos em `orchestratorStages.test.js`
  cobrem os três desfechos do branch mobile de `humanStage.js` (indisponível/passou/achou
  problema). 3 testes novos em `mobileSupport.test.js` cobrem `resolveBundleId` (pbxproj > app.json
  > null).
- **O que NÃO foi verificado ao vivo nesta sessão**: uma sessão XCUITest real contra um Simulador
  de verdade com um app Expo de verdade instalado — exigiria instalar `appium` + driver `xcuitest`,
  construir o WebDriverAgent (build nativo de vários minutos) e ter um app já implantado via
  `expo run:ios`. O que FOI verificado ao vivo: que o ambiente tem Xcode/Simulador funcionais
  (`xcrun simctl list devices` rodou de verdade), e que o código fala o protocolo HTTP do Appium
  corretamente contra um servidor real (só não o Appium real). Documentado aqui em vez de alegar
  cobertura que não existe — mesmo princípio do ADR-022 pro `npx playwright install chromium` como
  passo manual de pré-requisito, não algo que o ForjaIA provisiona sozinho.
- `FORJA_APPIUM_URL`/`FORJA_APPIUM_TIMEOUT_MS` são opt-in por env var — sem configurar nada, o
  comportamento observável pra quem não tem Appium é idêntico ao de antes deste ADR.
