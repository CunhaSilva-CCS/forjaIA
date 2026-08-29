# ADR-018 — Deploy mobile também para macOS (Catalyst) e Windows (GitHub Actions)

**Status:** Aceito

## Contexto

ADR-014 deu ao ForjaIA um caminho de deploy pra projetos Expo/React Native, mas só pro Simulador de
iPhone. Pedido do usuário: estender esse deploy pra também cobrir macOS e Windows, os outros dois
alvos de desktop que o React Native suporta (via Mac Catalyst e `react-native-windows`,
respectivamente).

Duas perguntas de viabilidade, resolvidas antes de codar:

1. **macOS**: dá pra reaproveitar o mesmo projeto Xcode do iOS (`SUPPORTS_MACCATALYST`), sem uma
   pasta nativa separada como o `react-native-macos` exigiria — testável neste Mac.
2. **Windows**: não existe cross-compilação de app nativo Windows a partir de macOS. O usuário
   perguntou diretamente "mesmo fazendo o build no GitHub?" — resposta correta: sim, um runner
   `windows-latest` do GitHub Actions tem Visual Studio de verdade; `gh` CLI já está autenticado
   neste ambiente. Esse é o único caminho viável a partir desta máquina.

## Decisão

**macOS via Mac Catalyst** (`lib/mobileDeploy.js` — `supportsMacCatalyst`, `deployToMac`,
`findBuiltMacApp`): `findXcodeWorkspace()` acha o `.xcworkspace` em `ios/` (convenção Expo/RN: nome
do workspace == nome do scheme). `supportsMacCatalyst()` roda `xcodebuild -showdestinations` e só
retorna `true` se o destino `platform:macOS` tiver `variant:Mac Catalyst` explicitamente (não
qualquer destino macOS — ver achado real abaixo). `deployToMac()` chama `xcodebuild` **direto**,
fora do Expo CLI, com `-destination "platform=macOS,name=My Mac"`, assinatura ad-hoc
(`CODE_SIGN_IDENTITY=-`, sem exigir signing — equivalente a "Sign to Run Locally" do Xcode), depois
`findBuiltMacApp()` acha o `.app` no DerivedData e `open` o lança.

**Windows via GitHub Actions** (`lib/windowsDeploy.js`, novo): `supportsWindows()` exige que o
projeto já tenha a pasta `windows/` (via `react-native-windows-init`, scaffolding único de
configuração do projeto — ForjaIA não gera isso a cada deploy) **e** um workflow
`.github/workflows/windows-build.yml` commitados. `triggerWindowsBuild()` dispara
`gh workflow run`, espera o run aparecer (`gh run list`, com delay configurável — disparo e
listagem não são atômicos), e faz polling (`gh run view --json status,conclusion,url`) até
`completed`. Sucesso ou falha inclui o link do run; não existe "abrir na tela" pra esse alvo — o
resultado observável é o build ter passado ou não.

**Orquestração** (`agent/devops.js` — `deployMobile`): os 3 alvos são tentados em sequência —
Simulador sempre, macOS e Windows condicionados a `supportsMacCatalyst`/`supportsWindows`. Falha em
um alvo (ex.: Windows sem workflow, ou o build do GitHub falhar) não derruba os outros — cada
resultado vai pra um array `targets: [{ platform, ok, ... }]`, com `deployStage.js`
(`describeDeployTargets`) montando uma descrição legível cobrindo o shape novo (multi-alvo) e os
shapes antigos (URL única, Simulador único) pra não quebrar nada que já lia `deployResult`.

## Achados reais durante a validação ao vivo (secPass)

Rodar contra o mesmo projeto real do ADR-014 (secPass) achou dois problemas que só apareceriam em
uso real, nenhum coberto por suposição de design:

1. **`expo run:ios --device "My Mac"` não existe** — a primeira implementação reusava
   `runExpoRunIos()` (o mesmo helper do Simulador) passando `"My Mac"` como nome de device.
   Confirmado via `--help` do Expo CLI e um erro real (`CommandError: No device UDID or name
   matching "my mac"`): o `-d/--device` do Expo só resolve simuladores e dispositivos físicos iOS —
   "My Mac" só existe no vocabulário do `xcodebuild -showdestinations`, não no do Expo. Corrigido
   pulando o Expo CLI inteiramente nesse passo e chamando `xcodebuild` direto.
2. **"My Mac" nem sempre é Mac Catalyst** — mesmo depois da correção acima, o build passava
   (`BUILD SUCCEEDED`) mas `open` no `.app` falhava com "incorrect executable format". Investigando:
   o projeto secPass não tem `SUPPORTS_MACCATALYST` habilitado; o destino "My Mac" que o Xcode
   oferece pra ele é `variant:Designed for [iPad,iPhone]` — Apple Silicon rodando o binário iOS
   original sem recompilar pra uma ABI macOS, não Catalyst de verdade. Confirmado via `otool -l`
   no binário gerado: `LC_BUILD_VERSION platform 2` (iOS), não macOS. Esse modo não tem caminho de
   linha de comando conhecido pra lançar fora do próprio Xcode — nem `open` no `.app` funciona, nem
   `xcrun devicectl` reconhece "My Mac" como device instalável (só lista dispositivos físicos
   pareados). Corrigido: `supportsMacCatalyst()` agora exige `variant:Mac Catalyst` explicitamente
   no `-showdestinations`, não só "existe destino macOS" — projetos como o secPass (Designed for
   iPad, mas sem Catalyst real) corretamente pulam o alvo macOS com aviso, em vez de compilar um
   binário que não abre.

## Consequências

- **macOS só funciona em projetos com Catalyst de verdade habilitado no Xcode**
  (`SUPPORTS_MACCATALYST=YES`) — a maioria dos projetos Expo/RN recém-criados (como o secPass) usa
  "Designed for iPad" por padrão, que este ADR **não** cobre (sem caminho de CLI conhecido pra
  automatizar). O pipeline detecta e pula honestamente esse caso, não finge suporte.
- O caminho de sucesso do macOS (`xcodebuild` + `open` num projeto com Catalyst real habilitado) foi
  validado por teste unitário com `xcodebuild` mockado, mas **não** contra um projeto real com
  Catalyst habilitado (nenhum disponível neste ambiente) — lacuna conhecida, mesma honestidade do
  ADR-014 sobre não fingir cobertura que não existe.
- Windows exige que o projeto já tenha passado por `react-native-windows-init` e tenha o workflow
  commitado — ForjaIA não faz esse scaffolding sozinho a cada deploy (decisão de configuração única
  do projeto, fora do escopo de uma etapa repetível de pipeline).
- Build Windows real consome minutos de runner do GitHub Actions por deploy — mais lento e com
  custo direto (minutos de CI), diferente dos outros dois alvos que rodam local.
- Falha em macOS ou Windows nunca impede o Simulador de ter sucesso — os 3 alvos são independentes;
  `targets[].ok` por alvo é a fonte da verdade, não um booleano único de deploy.

## Windows: bloqueio real ao tentar habilitar no secPass

Ao tentar aplicar o scaffolding Windows (`react-native-windows-init`) no projeto real usado pra
validar este ADR (secPass, React Native 0.86.2), a CLI recusou: a versão estável mais recente do
`react-native-windows` (0.84.0, confirmado via `npm view react-native-windows` — `latest: 0.84.0`)
só suporta `react-native@^0.84`. Existe um `0.85.0-preview.1` publicado, mas é build de
pré-lançamento, não recomendado pra um workflow de CI. Não é uma falha de configuração corrigível —
é o ecossistema do `react-native-windows` ainda não ter alcançado versões recentes do React Native.

Decisão: não instalar o pacote preview nem rebaixar a versão de React Native do secPass só pra
habilitar Windows (mudança de dependência real num app de produção, fora do escopo deste ADR). O
código deste ADR (`lib/windowsDeploy.js`, `supportsWindows`/`triggerWindowsBuild`) fica pronto e
testado para qualquer projeto que já tenha `windows/` + o workflow commitados — só não foi possível
demonstrar ponta a ponta contra o secPass por essa incompatibilidade de versão, específica desse
projeto, não do ForjaIA.

**Atualização (ADR-030)**: a lacuna acima — nunca ter rodado `triggerWindowsBuild` contra o GitHub
Actions de verdade, só com `gh` mockado — foi fechada depois. `triggerWindowsBuild` não depende do
conteúdo real de `windows/` (só da existência da pasta + do workflow), então não precisava de um
scaffold `react-native-windows` de verdade pra ser verificado: um repositório descartável com um
workflow mínimo `windows-latest` bastou. Rodei os dois caminhos (sucesso e falha) contra a API real
— nenhum bug encontrado. Detalhes na seção "Verificação ao vivo" do ADR-030.
