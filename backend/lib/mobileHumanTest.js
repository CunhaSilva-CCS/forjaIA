/**
 * Verificação real de UI mobile via Appium (ver ADR-029/031) — equivalente ao lib/browserCheck.js
 * (ADR-022), mas pros caminhos iOS Simulador/Android Emulador que humanStage.js pulava
 * incondicionalmente (ver comentário histórico em agent/stages/humanStage.js, que já documentava
 * isso como gap conhecido desde o ADR-014: "sem ferramenta de automação de UI nativa disponível").
 *
 * Fala HTTP direto com o protocolo WebDriver do Appium (sem SDK cliente) — evita puxar a árvore de
 * dependências de webdriverio/webdriver, que hoje arrasta @puppeteer/browsers e deepmerge-ts com
 * CVEs HIGH ativos (confirmado via `npm audit` antes de decidir por isso) só pra funcionalidade de
 * auto-download de browser que este uso nunca precisaria. Appium expõe uma API REST simples o
 * bastante pra não justificar esse custo — os dois drivers (XCUITest pro iOS, UiAutomator2 pro
 * Android) falam o MESMO protocolo REST, só a árvore de acessibilidade e as capabilities mudam de
 * formato.
 */
const fs = require('fs');
const path = require('path');
const { resolveScreenshotsDir } = require('./browserCheck');

const APPIUM_URL = (process.env.FORJA_APPIUM_URL || 'http://127.0.0.1:4723').replace(/\/$/, '');
const APPIUM_TIMEOUT_MS = Number(process.env.FORJA_APPIUM_TIMEOUT_MS || 20000);
// Achado real (verificação ao vivo contra um Appium/XCUITest de verdade, não só mock): a criação
// da sessão dispara um build nativo do WebDriverAgent via xcodebuild na primeira vez que aquele
// destino/UDID é usado — o próprio Appium espera até 2×60s só nessa etapa (2 tentativas de
// startup), e o xcodebuild em si pode levar minutos além disso. 20s (bom o bastante pra
// screenshot/source/click de rotina) derrubava a criação de sessão antes de ela terminar.
const SESSION_TIMEOUT_MS = Number(process.env.FORJA_APPIUM_SESSION_TIMEOUT_MS || 180000);
const CTA_PATTERN = /entrar|login|começar|comecar|iniciar|criar|enviar|salvar|continuar/i;

async function appiumFetch(url, options = {}, timeoutMs = APPIUM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.value?.message || body?.value?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Appium expõe /status igual a qualquer servidor WebDriver — não exige sessão pra responder. */
async function checkAppiumAvailable() {
  try {
    await appiumFetch(`${APPIUM_URL}/status`);
    return true;
  } catch {
    return false;
  }
}

/** Extração leve dos rótulos visíveis na árvore de acessibilidade — mesmo espírito do parsing de
 * botões que summarizeHtml já faz pro lado web, sem puxar um parser XML só pra isso. Usada só pra
 * "a tela tem algum texto visível" (checagem de tela em branco) — inclui texto estático de
 * propósito. iOS (XCUITest) usa `label`/`name`; Android (UiAutomator2) usa `text`/`content-desc`. */
function extractLabels(pageSourceXml, platform = 'ios') {
  const labels = new Set();
  const re = platform === 'android' ? /(?:text|content-desc)="([^"]+)"/g : /(?:label|name)="([^"]+)"/g;
  let m;
  while ((m = re.exec(pageSourceXml || ''))) {
    if (m[1].trim()) labels.add(m[1].trim());
  }
  return [...labels];
}

/**
 * Achado real (verificação ao vivo contra um app React Native de verdade no Simulador, 2 rodadas
 * de ajuste): em RN no iOS, um botão tocável (Pressable/TouchableOpacity) normalmente vira
 * `XCUIElementTypeOther` na árvore de acessibilidade, NÃO `XCUIElementTypeButton` — filtrar só por
 * tipo erraria justamente nos apps mais comuns. Primeira tentativa: filtrar só por
 * `accessible="true"` — errado também, porque o iOS expõe TEXTO ESTÁTICO como `accessible="true"`
 * pra leitura por VoiceOver (confirmado: o mesmo título "Entrar no SecPass" aparece DUAS vezes na
 * árvore real, uma com `accessible="false"` e outra com `accessible="true"`, mesmas coordenadas —
 * é a representação de navegação do VoiceOver, não um sinal de "isto é tocável"). O sinal certo é
 * a combinação: tipo de elemento que não é claramente não-interativo (texto/imagem/campo/app) E
 * `accessible="true"` E `enabled="true"`.
 */
const IOS_NON_TAPPABLE_TYPES = new Set([
  'XCUIElementTypeApplication',
  'XCUIElementTypeStaticText',
  'XCUIElementTypeImage',
  'XCUIElementTypeTextField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeScrollView',
  'XCUIElementTypeWindow'
]);

function extractTappableLabelsIos(pageSourceXml) {
  const labels = new Set();
  const tagRe = /<(XCUIElementType\w+)\s[^>]*>/g;
  let m;
  while ((m = tagRe.exec(pageSourceXml || ''))) {
    const [tag, type] = m;
    if (IOS_NON_TAPPABLE_TYPES.has(type)) continue;
    if (!/\baccessible="true"/.test(tag) || !/\benabled="true"/.test(tag)) continue;
    const labelMatch = tag.match(/\blabel="([^"]+)"/);
    if (labelMatch && labelMatch[1].trim()) labels.add(labelMatch[1].trim());
  }
  return [...labels];
}

/**
 * Achado real (verificação ao vivo contra um app React Native/Compose de verdade num emulador
 * Android): diferente do iOS, `clickable="true"` no Android (UiAutomator2) É o sinal direto e
 * limpo de "isto é tocável" — sem a ambiguidade do `accessible` do iOS (que o VoiceOver também usa
 * pra texto puramente informativo). Confirmado numa tela real de PIN: os botões de dígito são
 * `class="android.widget.Button" clickable="true"` com o rótulo acessível no atributo
 * `content-desc` (ex.: "Dígito 1") — o texto visível ("1") fica num `TextView` FILHO separado,
 * `clickable="false"`, então cair só pro `text` perderia o rótulo certo nesses casos. Prioriza
 * `content-desc`, cai pro `text` do próprio nó só se `content-desc` vier vazio.
 *
 * Achado real #2, mesma verificação: o XML que o Appium/UiAutomator2 devolve via `/source` usa o
 * NOME DA CLASSE como tag (`<android.widget.Button ...>`), diferente do `adb shell uiautomator
 * dump` (que usa `<node class="..." ...>` genérico) — minha primeira suposição, baseada só no dump
 * bruto, não batia com o que o driver de verdade retorna. O regex de tag precisa casar qualquer
 * nome de classe Android (`letras.pontos.Maiúsculas`), não um tag fixo `<node`.
 */
function extractTappableLabelsAndroid(pageSourceXml) {
  const labels = new Set();
  const tagRe = /<[\w.]+\s[^>]*\/?>/g;
  let m;
  while ((m = tagRe.exec(pageSourceXml || ''))) {
    const tag = m[0];
    if (!/\bclickable="true"/.test(tag) || !/\benabled="true"/.test(tag)) continue;
    const contentDesc = tag.match(/\bcontent-desc="([^"]*)"/);
    const text = tag.match(/\btext="([^"]*)"/);
    const label = (contentDesc?.[1] || '').trim() || (text?.[1] || '').trim();
    if (label) labels.add(label);
  }
  return [...labels];
}

function extractTappableLabels(pageSourceXml, platform = 'ios') {
  return platform === 'android' ? extractTappableLabelsAndroid(pageSourceXml) : extractTappableLabelsIos(pageSourceXml);
}

function iosCapabilities({ simulatorUdid, bundleId }) {
  return {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': simulatorUdid,
    'appium:bundleId': bundleId,
    'appium:noReset': true,
    'appium:newCommandTimeout': 120
  };
}

/** `appium:autoLaunch: false` — o app já foi aberto pelo `expo run:android` (ADR-031); relançar
 * reiniciaria o processo/estado que acabou de subir, em vez de anexar na sessão já rodando. */
function androidCapabilities({ emulatorSerial, androidPackage }) {
  return {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:udid': emulatorSerial,
    'appium:appPackage': androidPackage,
    'appium:noReset': true,
    'appium:autoLaunch': false,
    'appium:newCommandTimeout': 120
  };
}

async function createSession(platform, ids) {
  const capabilities = platform === 'android' ? androidCapabilities(ids) : iosCapabilities(ids);
  const body = await appiumFetch(
    `${APPIUM_URL}/session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: capabilities } })
    },
    SESSION_TIMEOUT_MS
  );
  const sessionId = body?.value?.sessionId || body?.sessionId;
  if (!sessionId) throw new Error('Appium não retornou sessionId');
  return sessionId;
}

async function closeSession(sessionId) {
  if (!sessionId) return;
  try {
    await appiumFetch(`${APPIUM_URL}/session/${sessionId}`, { method: 'DELETE' });
  } catch {
    // best-effort — não deixa vazar sessão travando o simulador/emulador, mas também não falha o teste por causa disso
  }
}

async function takeScreenshot(sessionId, screenshotsDir, filename) {
  const body = await appiumFetch(`${APPIUM_URL}/session/${sessionId}/screenshot`);
  const b64 = body?.value;
  if (!b64) return null;
  const filePath = path.join(screenshotsDir, filename);
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
  return filePath;
}

/** iOS resolve por predicate string nativo do XCUITest; Android não tem equivalente — XPath é a
 * estratégia universal do protocolo WebDriver, e cobre tanto content-desc quanto text num só XPath
 * (`or`), já que o rótulo pode estar em qualquer um dos dois (ver extractTappableLabelsAndroid). */
async function clickByLabel(sessionId, label, platform = 'ios') {
  const escaped = label.replace(/'/g, "\\'");
  const locator =
    platform === 'android'
      ? { using: '-android uiautomator', value: `new UiSelector().descriptionContains("${escaped}")` }
      : { using: '-ios predicate string', value: `label == '${escaped}' OR name == '${escaped}'` };
  let found;
  try {
    found = await appiumFetch(`${APPIUM_URL}/session/${sessionId}/element`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(locator)
    });
  } catch (err) {
    if (platform !== 'android') throw err;
    // UiSelector com aspas/caracteres especiais no rótulo pode falhar a montar — XPath cobre
    // content-desc e text no mesmo locator como fallback universal.
    found = await appiumFetch(`${APPIUM_URL}/session/${sessionId}/element`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ using: 'xpath', value: `//*[@content-desc='${escaped}' or @text='${escaped}']` })
    });
  }
  const elementId = found?.value?.ELEMENT || found?.value?.['element-6066-11e4-a52e-4f735466cecf'];
  if (!elementId) throw new Error(`Elemento com label "${label}" não encontrado`);
  await appiumFetch(`${APPIUM_URL}/session/${sessionId}/element/${elementId}/click`, { method: 'POST' });
}

/**
 * Abre o app já instalado no Simulador/Emulador (por devopsLoadStage/deployStage) numa sessão
 * Appium de verdade: confirma que a árvore de acessibilidade não está vazia (equivalente mobile do
 * UX-BLANK-PAGE do browserCheck), tenta tocar num botão plausível de verdade, e tira screenshot
 * antes/depois. Degrada graciosamente (sem bloquear o teste humano) se não houver servidor Appium
 * acessível — mesma postura de checkPlaywrightAvailable.
 *
 * `platform` é `'ios'` (default, compat com chamadas do ADR-029) ou `'android'` — deriva as
 * capabilities/extração corretas; os IDs relevantes pra cada plataforma (simulatorUdid+bundleId ou
 * emulatorSerial+androidPackage) é quem efetivamente distingue o alvo.
 */
async function runMobileHumanTest({
  platform = 'ios',
  simulatorUdid,
  bundleId,
  emulatorSerial,
  androidPackage,
  runConfig = {},
  orchestrator
}) {
  const ids = platform === 'android' ? { emulatorSerial, androidPackage } : { simulatorUdid, bundleId };
  const hasIds = platform === 'android' ? Boolean(emulatorSerial && androidPackage) : Boolean(simulatorUdid && bundleId);
  const deviceLabel = platform === 'android' ? 'emulador Android' : 'Simulador';

  if (!hasIds) {
    return {
      available: false,
      ok: true,
      skippedReason: `sem os identificadores do deploy (${platform === 'android' ? 'emulatorSerial/androidPackage' : 'simulatorUdid/bundleId'}) — não dá pra abrir uma sessão Appium sem saber onde/o quê.`,
      issues: [],
      screenshots: []
    };
  }

  const available = await checkAppiumAvailable();
  if (!available) {
    const driver = platform === 'android' ? 'uiautomator2' : 'xcuitest';
    return {
      available: false,
      ok: true,
      skippedReason: `servidor Appium não respondeu em ${APPIUM_URL} (npx appium server, com o driver ${driver} instalado: appium driver install ${driver})`,
      issues: [],
      screenshots: []
    };
  }

  const screenshotsDir = resolveScreenshotsDir(runConfig);
  const stamp = Date.now();
  const issues = [];
  const screenshots = [];
  let sessionId = null;
  let clickedLabel = null;

  try {
    sessionId = await createSession(platform, ids);

    const shot1 = await takeScreenshot(sessionId, screenshotsDir, `human-mobile-${platform}-${stamp}-1-inicial.png`);
    if (shot1) screenshots.push(shot1);

    const sourceBody = await appiumFetch(`${APPIUM_URL}/session/${sessionId}/source`);
    const pageSource = sourceBody?.value || '';
    const labels = extractLabels(pageSource, platform);

    if (!labels.length) {
      issues.push({
        id: 'UX-MOBILE-BLANK-SCREEN',
        severity: 'CRITICAL',
        title: `Tela do app no ${deviceLabel} não expõe nenhum elemento de acessibilidade`,
        description: `A sessão Appium abriu, mas a árvore de acessibilidade veio vazia — sinal de tela em branco ou crash silencioso, do mesmo jeito que UX-BLANK-PAGE pega isso no lado web.`,
        remediation: 'Abrir o Simulador/Emulador manualmente e conferir se o app realmente renderizou algo (erro de bundle JS do Metro é a causa mais comum).'
      });
    }

    const tappableLabels = extractTappableLabels(pageSource, platform);
    const target = tappableLabels.find((l) => CTA_PATTERN.test(l));
    if (target) {
      try {
        await clickByLabel(sessionId, target, platform);
        clickedLabel = target;
        await new Promise((r) => setTimeout(r, 800));
        const shot2 = await takeScreenshot(sessionId, screenshotsDir, `human-mobile-${platform}-${stamp}-2-apos-toque.png`);
        if (shot2) screenshots.push(shot2);
      } catch (err) {
        issues.push({
          id: 'UX-MOBILE-BUTTON-UNTAPPABLE',
          severity: 'MEDIUM',
          title: `Elemento "${target}" apareceu na árvore de acessibilidade mas não pôde ser tocado de verdade`,
          description: err.message,
          remediation: 'Verificar se o elemento está realmente na tela e habilitado pra interação (não só presente na hierarquia).'
        });
      }
    }
  } catch (err) {
    issues.push({
      id: 'UX-MOBILE-SESSION-FAILED',
      severity: 'HIGH',
      title: `Não foi possível abrir/usar uma sessão Appium contra o app no ${deviceLabel}`,
      description: err.message,
      remediation:
        platform === 'android'
          ? 'Confirmar que o emulador está com o app instalado e o driver uiautomator2 está funcionando (appium driver doctor uiautomator2).'
          : 'Confirmar que o Simulador está com o app instalado e o driver xcuitest está funcionando (appium driver doctor xcuitest).'
    });
  } finally {
    await closeSession(sessionId);
  }

  const ok = !issues.some((i) => ['HIGH', 'CRITICAL'].includes(i.severity));
  orchestrator?.log?.(
    'human',
    ok
      ? `Verificação de UI real no ${deviceLabel} (Appium): app abriu${clickedLabel ? `, toquei em "${clickedLabel}"` : ''}, sem erro grave.`
      : `Verificação de UI real no ${deviceLabel} (Appium) achou ${issues.length} problema(s).`,
    ok ? 'info' : 'warning'
  );

  return { available: true, ok, issues, screenshots, clickedLabel };
}

module.exports = { runMobileHumanTest, checkAppiumAvailable, extractLabels, extractTappableLabels };
