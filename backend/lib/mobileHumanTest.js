/**
 * Verificação real de UI mobile via Appium/XCUITest (ver ADR-029) — equivalente ao
 * lib/browserCheck.js (ADR-022), mas pro caminho iOS Simulador que humanStage.js pulava
 * incondicionalmente (ver comentário histórico em agent/stages/humanStage.js, que já documentava
 * isso como gap conhecido desde o ADR-014: "sem ferramenta de automação de UI nativa disponível").
 *
 * Fala HTTP direto com o protocolo WebDriver do Appium (sem SDK cliente) — evita puxar a árvore de
 * dependências de webdriverio/webdriver, que hoje arrasta @puppeteer/browsers e deepmerge-ts com
 * CVEs HIGH ativos (confirmado via `npm audit` antes de decidir por isso) só pra funcionalidade de
 * auto-download de browser que este uso nunca precisaria. Appium expõe uma API REST simples o
 * bastante pra não justificar esse custo.
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

/** Extração leve dos rótulos visíveis na árvore de acessibilidade (XML do XCUITest) — mesmo
 * espírito do parsing de botões que summarizeHtml já faz pro lado web, sem puxar um parser XML só
 * pra isso. Usada só pra "a tela tem algum texto visível" (checagem de tela em branco) — inclui
 * texto estático de propósito. */
function extractLabels(pageSourceXml) {
  const labels = new Set();
  const re = /(?:label|name)="([^"]+)"/g;
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
const NON_TAPPABLE_TYPES = new Set([
  'XCUIElementTypeApplication',
  'XCUIElementTypeStaticText',
  'XCUIElementTypeImage',
  'XCUIElementTypeTextField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeScrollView',
  'XCUIElementTypeWindow'
]);

function extractTappableLabels(pageSourceXml) {
  const labels = new Set();
  const tagRe = /<(XCUIElementType\w+)\s[^>]*>/g;
  let m;
  while ((m = tagRe.exec(pageSourceXml || ''))) {
    const [tag, type] = m;
    if (NON_TAPPABLE_TYPES.has(type)) continue;
    if (!/\baccessible="true"/.test(tag) || !/\benabled="true"/.test(tag)) continue;
    const labelMatch = tag.match(/\blabel="([^"]+)"/);
    if (labelMatch && labelMatch[1].trim()) labels.add(labelMatch[1].trim());
  }
  return [...labels];
}

async function createSession({ simulatorUdid, bundleId }) {
  const body = await appiumFetch(
    `${APPIUM_URL}/session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: {
            platformName: 'iOS',
            'appium:automationName': 'XCUITest',
            'appium:udid': simulatorUdid,
            'appium:bundleId': bundleId,
            'appium:noReset': true,
            'appium:newCommandTimeout': 120
          }
        }
      })
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
    // best-effort — não deixa vazar sessão travando o simulador, mas também não falha o teste por causa disso
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

async function clickByLabel(sessionId, label) {
  const escaped = label.replace(/'/g, "\\'");
  const found = await appiumFetch(`${APPIUM_URL}/session/${sessionId}/element`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ using: '-ios predicate string', value: `label == '${escaped}' OR name == '${escaped}'` })
  });
  const elementId = found?.value?.ELEMENT || found?.value?.['element-6066-11e4-a52e-4f735466cecf'];
  if (!elementId) throw new Error(`Elemento com label "${label}" não encontrado`);
  await appiumFetch(`${APPIUM_URL}/session/${sessionId}/element/${elementId}/click`, { method: 'POST' });
}

/**
 * Abre o app já instalado no Simulador (por devopsLoadStage/deployStage) numa sessão XCUITest de
 * verdade: confirma que a árvore de acessibilidade não está vazia (equivalente mobile do
 * UX-BLANK-PAGE do browserCheck), tenta tocar num botão plausível de verdade, e tira
 * screenshot antes/depois. Degrada graciosamente (sem bloquear o teste humano) se não houver
 * servidor Appium acessível — mesma postura de checkPlaywrightAvailable.
 */
async function runMobileHumanTest({ simulatorUdid, bundleId, runConfig = {}, orchestrator }) {
  if (!simulatorUdid || !bundleId) {
    return {
      available: false,
      ok: true,
      skippedReason: 'sem simulatorUdid/bundleId do deploy — não dá pra abrir uma sessão Appium sem saber onde/o quê.',
      issues: [],
      screenshots: []
    };
  }

  const available = await checkAppiumAvailable();
  if (!available) {
    return {
      available: false,
      ok: true,
      skippedReason: `servidor Appium não respondeu em ${APPIUM_URL} (npx appium server, com o driver xcuitest instalado: appium driver install xcuitest)`,
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
    sessionId = await createSession({ simulatorUdid, bundleId });

    const shot1 = await takeScreenshot(sessionId, screenshotsDir, `human-mobile-${stamp}-1-inicial.png`);
    if (shot1) screenshots.push(shot1);

    const sourceBody = await appiumFetch(`${APPIUM_URL}/session/${sessionId}/source`);
    const pageSource = sourceBody?.value || '';
    const labels = extractLabels(pageSource);

    if (!labels.length) {
      issues.push({
        id: 'UX-MOBILE-BLANK-SCREEN',
        severity: 'CRITICAL',
        title: 'Tela do app no Simulador não expõe nenhum elemento de acessibilidade',
        description: 'A sessão XCUITest abriu, mas a árvore de acessibilidade veio vazia — sinal de tela em branco ou crash silencioso, do mesmo jeito que UX-BLANK-PAGE pega isso no lado web.',
        remediation: 'Abrir o Simulador manualmente e conferir se o app realmente renderizou algo (erro de bundle JS do Metro é a causa mais comum).'
      });
    }

    const tappableLabels = extractTappableLabels(pageSource);
    const target = tappableLabels.find((l) => CTA_PATTERN.test(l));
    if (target) {
      try {
        await clickByLabel(sessionId, target);
        clickedLabel = target;
        await new Promise((r) => setTimeout(r, 800));
        const shot2 = await takeScreenshot(sessionId, screenshotsDir, `human-mobile-${stamp}-2-apos-toque.png`);
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
      title: 'Não foi possível abrir/usar uma sessão Appium contra o app no Simulador',
      description: err.message,
      remediation: 'Confirmar que o Simulador está com o app instalado e o driver xcuitest está funcionando (appium driver doctor xcuitest).'
    });
  } finally {
    await closeSession(sessionId);
  }

  const ok = !issues.some((i) => ['HIGH', 'CRITICAL'].includes(i.severity));
  orchestrator?.log?.(
    'human',
    ok
      ? `Verificação de UI real no Simulador (Appium/XCUITest): app abriu${clickedLabel ? `, toquei em "${clickedLabel}"` : ''}, sem erro grave.`
      : `Verificação de UI real no Simulador (Appium/XCUITest) achou ${issues.length} problema(s).`,
    ok ? 'info' : 'warning'
  );

  return { available: true, ok, issues, screenshots, clickedLabel };
}

module.exports = { runMobileHumanTest, checkAppiumAvailable, extractLabels, extractTappableLabels };
