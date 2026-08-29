# ADR-031 — Deploy e teste humano no emulador Android

**Status:** Aceito

## Contexto

O ForjaIA já suportava iOS Simulador (ADR-014), Mac Catalyst e Windows via GitHub Actions
(ADR-018), e teste humano real via Appium/XCUITest no Simulador (ADR-029) — mas nenhum caminho de
deploy ou teste pra Android, apesar do projeto declarar suporte a "Expo/React Native" de forma
geral. Pra um projeto RN, cujo par padrão é `expo run:ios`/`expo run:android`, essa é uma lacuna
real na promessa, não só um "nice to have" — apontada na própria auto-avaliação do projeto.

Levantamento de viabilidade: a máquina já tinha Android SDK, `adb`, `emulator` e dois AVDs
configurados (`Medium_Phone_API_36.1`, `Pixel_8_Pro`) — permitindo verificação ao vivo completa,
igual ao que o ADR-029 fez pro iOS.

## Decisão

**`lib/expoRunProcess.js`** (novo, extraído de `mobileDeploy.js`): o runner genérico de
`npx expo run:*` (detecção de sucesso por frase conhecida OU período de silêncio, processo
detached+stdio-em-arquivo pra sobreviver a um restart do ForjaIA) agora é compartilhado entre iOS e
Android — sem isso, a lógica de "esse processo nunca termina sozinho, sucesso é outra coisa" teria
que ser duplicada e podia divergir entre as duas plataformas.

**`lib/androidDeploy.js`** (novo, espelha `mobileDeploy.js`): `pickAndroidEmulator` (prefere um
emulador já rodando via `adb devices`; senão pega o primeiro AVD configurado — não cria um do
zero, mesma filosofia do Windows/ADR-018: configuração de ambiente do usuário, não etapa
repetível), `ensureAndroidBooted` (boota em background, espera aparecer no `adb devices`, espera
`sys.boot_completed=1` de verdade — sem isso `expo run:android` tenta instalar num device que
ainda não processa intents), `resolveAndroidPackage` (lê `applicationId` do
`android/app/build.gradle` gerado pelo prebuild, cai pro `app.json` só se ainda não rodou).
Validação de serial/AVD contra um regex seguro antes de interpolar em comando de shell — mesma
disciplina do `SAFE_XCODE_NAME` em `mobileDeploy.js`.

**`agent/devops.js`**: `deployMobile` tenta emulador Android sempre, ao lado do Simulador iOS (os
dois fazem parte do par padrão de qualquer projeto Expo/RN — diferente de Mac Catalyst/Windows,
que exigem scaffolding extra opcional). Também corrigido de passagem: o Simulador iOS agora está
com o mesmo try/catch que macOS/Windows já tinham — antes, uma falha nele derrubava a função
inteira e nem tentava os outros alvos.

**`lib/mobileHumanTest.js`**: generalizado pra aceitar `platform: 'ios'|'android'`.
`agent/stages/humanStage.js` agora testa CADA alvo mobile que teve deploy bem-sucedido (iOS e/ou
Android podem coexistir no mesmo deploy multi-plataforma) e mescla os achados.

## Verificação ao vivo (Appium/UiAutomator2 real, app RN/Compose real)

Instalei Appium + driver `uiautomator2`, buildei e instalei um app real (ControlContFin, RN 0.86.2
+ Compose) num emulador booted (`Medium_Phone_API_36.1`), e testei contra a sessão real — 225s de
ponta a ponta (boot + gradle + instalação). **Três achados reais, nenhum pego por mock:**

1. **Sucesso do deploy precede o primeiro paint do app**: o primeiro screenshot tirado logo após
   `deployToAndroidEmulator` resolver mostrou uma tela quase em branco (só o menu dev do Expo) — o
   app ainda não tinha terminado de montar. Um segundo screenshot ~5s depois mostrou o app real
   (tela de criar PIN). Não é um bug de código — `runExpoRun` já sinaliza sucesso por frase de log
   (Metro conectado), não pelo primeiro frame renderizado, mesma característica que já existia pro
   iOS. `humanStage.js` roda bem depois no pipeline (após `devopsLoadStage`), dando tempo de sobra
   naturalmente; documentado aqui pra não ser redescoberto como "bug" depois.
2. **`accessible`-like não existe no Android — mas o problema equivalente ao iOS (VoiceOver
   duplicando texto estático como "acessível") não se repete**: `clickable="true"` é um sinal
   limpo e direto de "isto é tocável" no UiAutomator2, confirmado numa tela de PIN real: botões de
   dígito são `class="android.widget.Button" clickable="true"`, texto puramente informativo
   (títulos) vem `clickable="false"`. Mais simples de acertar que o iOS.
3. **O XML que `/source` devolve usa o NOME DA CLASSE como tag** (`<android.widget.Button ...>`),
   diferente do que `adb shell uiautomator dump` bruto produz (`<node class="..." ...>` genérico)
   — minha primeira implementação assumiu o formato do dump bruto (só verificado via
   documentação/exemplos, não contra o driver de verdade) e `extractTappableLabelsAndroid` nunca
   batia com nada real. Só apareceu testando contra uma sessão Appium de verdade, não um servidor
   fake que eu mesmo escrevi certo da primeira vez. Corrigido: regex de tag genérico
   (`<[\w.]+\s[^>]*\/?>`) em vez de `<node`.

Depois das correções: sessão anexou ao app já aberto (`appium:autoLaunch: false`, sem relançar —
confirmado, preserva o estado que `expo run:android` acabou de deixar), encontrou e tocou o botão
"Dígito 1" via `-android uiautomator`/`descriptionContains`, e a tela avançou de verdade (ponto do
PIN preencheu, "Digite seu PIN" apareceu) — confirmado por screenshot antes/depois diferentes.

## Consequências

- Backend: 318/318. `androidDeploy.test.js` (10 testes, inclui a validação de serial contra
  interpolação em shell). `mobileHumanTest.test.js` ganhou 7 testes Android (extração com fixture
  real capturada ao vivo, sessão fake completa via protocolo UiAutomator2). `orchestratorStages.test.js`
  ganhou 2 testes cobrindo humanStage testando só Android e testando iOS+Android simultaneamente
  com mescla de achados. `multiPlatformDeploy.test.js` atualizado pros 4 alvos possíveis agora
  (era 3) e um novo teste confirmando que falha no iOS não derruba o Android.
- `FORJA_ANDROID_BOOT_WAIT_MS`/`FORJA_ANDROID_DEVICE_WAIT_MS`/`FORJA_ANDROID_POLL_MS` são opt-in
  por env var — sem Android SDK instalado, `deployMobile` simplesmente registra
  `android-emulator: {ok:false, error:...}` no array de alvos e segue com o iOS Simulador
  normalmente (não é regressão pra quem não tem o toolchain).
- Assim como o Windows (ADR-018), build Android real consome tempo real de máquina (emulador +
  Gradle, ~2-4 min na primeira vez) — mais lento que o Simulador iOS na prática, mesmo sem custo
  de CI (roda local).
- `descriptionContains` (locator `-android uiautomator`) pode falhar a montar com aspas/caracteres
  especiais no rótulo — `clickByLabel` cai pra XPath (`content-desc` ou `text`) como fallback
  universal nesse caso, mesmo raciocínio de robustez já usado no resto do arquivo.
