/**
 * Verificação real de UI via navegador (Playwright), ver ADR-022 — complementa o teste humano por
 * HTTP em agent/human.js. Aquele confirma que as ROTAS respondem certo (status/JSON); este
 * confirma que a PÁGINA renderiza de verdade e reage a interação real (clique) — o gap que o
 * ADR-014 documentou como conhecido e não coberto ("sem ferramenta de automação de UI disponível
 * no ambiente"). Não substitui o teste HTTP: um backend pode responder 200 em tudo e a SPA ainda
 * assim renderizar em branco por um erro de bundle — só abrindo num navegador de verdade isso
 * aparece.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

async function checkPlaywrightAvailable() {
  try {
    require.resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

/** Mesmo padrão de agent/reporter.js (ensureReportsDir): screenshot vive DENTRO da pasta do
 * projeto quando dá pra resolver, nunca solto na raiz do workspace compartilhado. */
function resolveScreenshotsDir(runConfig = {}) {
  const projectPath = runConfig.targetPath || runConfig.sourcePath || null;
  if (projectPath) {
    try {
      const { resolveWithinWorkspace } = require('./paths');
      const dir = path.join(resolveWithinWorkspace(projectPath), '_reports', 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // caminho inválido/fora do workspace → cai pro fallback abaixo
    }
  }
  const dir = path.join(config.workspaceRoot, '_reports', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const NAV_TIMEOUT_MS = Number(process.env.FORJA_BROWSER_TIMEOUT_MS || 15000);

/**
 * Abre `deployUrl` num Chromium headless de verdade: confirma que a página não fica em branco,
 * captura erro de console/requisição 5xx durante o carregamento, e — se houver algum botão
 * plausível (já extraído por discoverSurface via summarizeHtml, reaproveitado aqui) — clica nele
 * de verdade e tira um screenshot antes/depois. `buttons` vazio pula a etapa de clique sem erro.
 */
async function runBrowserCheck({ deployUrl, buttons = [], runConfig = {}, orchestrator }) {
  const available = await checkPlaywrightAvailable();
  if (!available) {
    return {
      available: false,
      ok: true, // não bloqueia o teste humano por HTTP — só não adiciona sinal extra
      skippedReason: 'playwright não está instalado (npm install playwright && npx playwright install chromium)',
      issues: [],
      screenshots: []
    };
  }

  const { chromium } = require('playwright');
  const screenshotsDir = resolveScreenshotsDir(runConfig);
  const stamp = Date.now();
  const issues = [];
  const consoleErrors = [];
  const failedRequests = [];
  const screenshots = [];
  let browser;
  let title = null;
  let clickedButton = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(String(msg.text() || '').slice(0, 300));
    });
    page.on('response', (res) => {
      if (res.status() >= 500) failedRequests.push(`${res.status()} ${res.url()}`);
    });

    await page.goto(deployUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    title = await page.title();
    const bodyText = (await page.textContent('body').catch(() => '')) || '';

    const shot1 = path.join(screenshotsDir, `human-ui-${stamp}-1-inicial.png`);
    await page.screenshot({ path: shot1 });
    screenshots.push(shot1);

    if (!bodyText.trim()) {
      issues.push({
        id: 'UX-BLANK-PAGE',
        severity: 'CRITICAL',
        title: 'Página renderizou em branco num navegador real',
        description: `A URL ${deployUrl} carregou (o servidor respondeu) mas o navegador não mostra nenhum texto visível no <body> — um teste só por HTTP não pega isso.`,
        remediation: 'Verificar erros de bundle/JS no console do navegador e se o root da SPA está montando de verdade.'
      });
    }

    if (buttons?.length) {
      const target =
        buttons.find((b) => /entrar|login|começar|iniciar|criar|enviar|salvar|continuar/i.test(b)) || buttons[0];
      try {
        await page.getByText(target, { exact: false }).first().click({ timeout: 5000 });
        clickedButton = target;
        await page.waitForTimeout(800); // dá tempo de qualquer efeito (navegação, fetch, DOM) acontecer
        const shot2 = path.join(screenshotsDir, `human-ui-${stamp}-2-apos-clique.png`);
        await page.screenshot({ path: shot2 });
        screenshots.push(shot2);
      } catch (err) {
        issues.push({
          id: 'UX-BUTTON-UNCLICKABLE',
          severity: 'MEDIUM',
          title: `Botão "${target}" apareceu no HTML mas não pôde ser clicado de verdade`,
          description: err.message,
          remediation: 'Verificar se o botão está visível/habilitado e responde a um clique real na tela (não só presente no markup).'
        });
      }
    }

    if (consoleErrors.length) {
      issues.push({
        id: 'UX-CONSOLE-ERROR',
        severity: 'MEDIUM',
        title: `${consoleErrors.length} erro(s) no console do navegador durante o uso`,
        description: consoleErrors.slice(0, 5).join(' | '),
        remediation: 'Corrigir os erros de JavaScript reportados pelo navegador real.'
      });
    }
    if (failedRequests.length) {
      issues.push({
        id: 'UX-SERVER-ERROR-ON-LOAD',
        severity: 'HIGH',
        title: `${failedRequests.length} requisição(ões) com erro 5xx durante o uso real`,
        description: failedRequests.slice(0, 5).join(' | '),
        remediation: 'Investigar os endpoints retornando 5xx durante o fluxo real de uso no navegador.'
      });
    }
  } catch (err) {
    const msg = String(err.message || err);
    if (/Executable doesn't exist|playwright install|browserType\.launch/i.test(msg)) {
      return {
        available: false,
        ok: true,
        skippedReason: 'Chromium do Playwright não instalado — rode: npx playwright install chromium',
        issues: [],
        screenshots: []
      };
    }
    issues.push({
      id: 'UX-BROWSER-CHECK-FAILED',
      severity: 'HIGH',
      title: 'Não foi possível abrir/usar o deploy num navegador real',
      description: msg,
      remediation:
        'Confirmar que o deploy está acessível e renderiza corretamente num navegador (não só via curl/fetch).'
    });
  } finally {
    await browser?.close().catch(() => undefined);
  }

  const ok = !issues.some((i) => ['HIGH', 'CRITICAL'].includes(i.severity));
  orchestrator?.log?.(
    'human',
    ok
      ? `Verificação de UI real (Playwright): página carregou${clickedButton ? `, cliquei em "${clickedButton}"` : ''}, sem erro grave.`
      : `Verificação de UI real (Playwright) achou ${issues.length} problema(s).`,
    ok ? 'info' : 'warning'
  );

  return { available: true, ok, title, issues, screenshots, consoleErrors, failedRequests, clickedButton };
}

module.exports = { runBrowserCheck, checkPlaywrightAvailable, resolveScreenshotsDir };
