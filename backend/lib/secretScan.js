/**
 * Scanner determinístico de segredos hardcoded (ver ADR-011). Complementa o regex de
 * "const/let/var NOME = valor" já existente em agent/security.js, que só cobre declaração JS/TS
 * com um nome de variável específico. Este módulo cobre duas frentes que o LLM revisor pode
 * deixar passar sem querer, mas uma ferramenta determinística nunca deveria:
 *
 * 1. Formato de token conhecido (prefixo real de provedor) — pega o segredo pelo FORMATO, não
 *    pelo nome da variável, então funciona em qualquer arquivo/sintaxe (.env, JSON, YAML, código).
 * 2. Atribuição de valor literal a uma chave com nome suspeito, em mais sintaxes que a original
 *    (objeto/JSON `chave: "valor"`, linha estilo .env `CHAVE=valor`), não só declaração JS.
 *
 * O resultado entra na mesma lista de issues que o SAST/DAST de security.js — o gate de
 * aprovação já é determinístico sobre allIssues.length (não passa por "achar que está seguro" de
 * um LLM), então basta alimentar essa lista pra virar bloqueio real.
 */

// Todas com flag 'g' — sem ela, `regex.exec()` em loop nunca avança e um SEGUNDO segredo
// distinto do mesmo tipo no mesmo arquivo nunca era reportado (achado real, pente fino).
const KNOWN_TOKEN_PATTERNS = [
  { id: 'SEC-TOKEN-ANTHROPIC', title: 'Chave de API da Anthropic exposta', regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  { id: 'SEC-TOKEN-OPENAI', title: 'Chave de API estilo OpenAI exposta', regex: /\bsk-[a-zA-Z0-9]{20,}\b/g },
  { id: 'SEC-TOKEN-GOOGLE', title: 'Chave de API do Google exposta', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { id: 'SEC-TOKEN-AWS', title: 'Access Key ID da AWS exposta', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'SEC-TOKEN-GITHUB', title: 'Token de acesso do GitHub exposto', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: 'SEC-TOKEN-SLACK', title: 'Token do Slack exposto', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,48}\b/g },
  { id: 'SEC-TOKEN-STRIPE', title: 'Chave secreta do Stripe exposta', regex: /\bsk_live_[0-9a-zA-Z]{16,}\b/g },
  { id: 'SEC-PRIVATE-KEY', title: 'Bloco de chave privada exposto', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g }
];

const SUSPICIOUS_ASSIGNMENTS = [
  {
    id: 'SEC-SECRET-JS-BROAD',
    // Mesmo espírito do regex original em security.js, mas sem exigir que o nome seja
    // exatamente JWT_SECRET/SECRET/API_KEY/PASSWORD — cobre variações (dbPassword, stripeSecret,
    // authToken, apiKey em camelCase etc.).
    regex: /(?:const|let|var)\s+\w*(secret|password|senha|token|api[_-]?key)\w*\s*=\s*['"`]([^'"`]{6,})['"`]/gi
  },
  {
    id: 'SEC-SECRET-OBJECT-LITERAL',
    // Objeto/JSON: { apiKey: "sk-...", "password": "hunter2" } — o lookbehind exclui
    // `.`/`?` logo antes da chave pra não casar member access (item.password) nem o `:` de um
    // ternário (cond ? item.password : "outro valor") como se fossem par chave:valor de objeto.
    regex: /(?<![.?])["']?\w*(secret|password|senha|token|api[_-]?key)\w*["']?\s*:\s*["']([^"']{6,})["']/gi
  }
];

/** Exportado — reaproveitado por agent/security.js pro regex original de segredo, que tem o
 * mesmo problema de falso positivo em fixture de teste (ver ADR-011, achado ao validar secPass). */
function isTestFile(filePath) {
  return /__tests__\/|\.(test|spec)\.[jt]sx?$/i.test(filePath || '');
}

// Segredo/token/senha de verdade não é uma frase — se o valor capturado tem espaço, é muito mais
// provável ser uma mensagem de erro/label cujo NOME contém "secret"/"senha" (ex.: uma constante
// chamada VAULT_SECRET_REQUIRED guardando o texto "Não é possível salvar sem a senha de acesso")
// do que o segredo em si.
function looksLikeSecretValue(value) {
  return !/\s/.test(value);
}

// Linha estilo .env com valor literal (não process.env, não vazio, não placeholder óbvio de exemplo)
const ENV_LINE_REGEX = /^[ \t]*[A-Z][A-Z0-9_]*(SECRET|PASSWORD|TOKEN|API_?KEY)[A-Z0-9_]*=(\S{6,})[ \t]*$/gim;

function isExampleFile(filePath) {
  return /\.(example|sample)(\.|$)/i.test(filePath || '') || /\.env\.example$/i.test(filePath || '');
}

function looksLikeEnvReference(context) {
  return /process\.env|import\.meta\.env/.test(context);
}

/**
 * Escaneia arquivos gerados (mesma forma { path, content } usada no resto do pipeline) em busca
 * de segredos hardcoded. Retorna issues no mesmo formato usado por runStaticAnalysis em
 * agent/security.js — plugável direto na mesma lista que já bloqueia aprovação.
 */
function scanForHardcodedSecrets(files) {
  const issues = [];
  const seen = new Set();

  const push = (issue) => {
    const key = `${issue.id}:${issue.file}:${issue.description}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  for (const file of files || []) {
    if (!file || typeof file.content !== 'string') continue;
    const code = file.content;
    const filePath = file.path || 'unknown';

    for (const pattern of KNOWN_TOKEN_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let m;
      while ((m = pattern.regex.exec(code))) {
        push({
          id: pattern.id,
          title: pattern.title,
          severity: 'CRITICAL',
          file: filePath,
          // O valor casado (não a posição) entra na descrição — dedup em push() é por
          // id:file:description, então o MESMO segredo repetido no arquivo ainda vira 1 issue
          // (comportamento esperado), mas um segredo DIFERENTE do mesmo tipo no mesmo arquivo
          // agora vira um issue separado (achado real: antes sem a flag 'g', a segunda
          // ocorrência nunca era nem examinada).
          // Prefixo curto (ex.: "sk-ant-api03-") é igual pra qualquer chave do mesmo provedor —
          // truncar cedo demais faria dois segredos DIFERENTES colidirem na dedup por engano.
          // O valor inteiro entra na key; só a exibição (se algum dia for renderizada) precisaria
          // truncar por conta própria.
          description: `Encontrado um valor no formato de ${pattern.title.toLowerCase()} diretamente no código-fonte ("${m[0]}").`,
          remediation: 'Remova o valor do código, revogue a credencial exposta e carregue-a via process.env.'
        });
        // Regex sem grupo de captura de comprimento variável (ex.: SEC-PRIVATE-KEY) pode casar
        // string vazia em teoria — nunca deste conjunto específico, mas avança lastIndex por
        // segurança pra nunca entrar em loop infinito.
        if (m.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
      }
    }

    for (const pattern of SUSPICIOUS_ASSIGNMENTS) {
      if (isTestFile(filePath)) continue;
      pattern.regex.lastIndex = 0;
      let m;
      while ((m = pattern.regex.exec(code))) {
        if (!looksLikeSecretValue(m[2])) continue;
        const windowStart = Math.max(0, m.index - 40);
        const context = code.slice(windowStart, m.index + m[0].length);
        if (looksLikeEnvReference(context)) continue;
        push({
          id: pattern.id,
          title: 'Segredo hardcoded em atribuição de valor',
          severity: 'HIGH',
          file: filePath,
          description: `Valor literal atribuído a uma chave com nome sensível ("${m[1]}"), sem vir de variável de ambiente.`,
          remediation: 'Mova o valor para .env e carregue via process.env, com validação de presença no bootstrap.'
        });
      }
    }

    if (!isExampleFile(filePath)) {
      ENV_LINE_REGEX.lastIndex = 0;
      let m;
      while ((m = ENV_LINE_REGEX.exec(code))) {
        push({
          id: 'SEC-SECRET-ENV-FILE',
          title: 'Segredo com valor real commitado em arquivo .env',
          severity: 'CRITICAL',
          file: filePath,
          description: `Linha "${m[0].trim().slice(0, 60)}" define um segredo com valor real, não um placeholder.`,
          remediation: 'Nunca commitar .env com valores reais — só .env.example com placeholders vazios/descritivos.'
        });
      }
    }
  }

  return issues;
}

module.exports = { scanForHardcodedSecrets, isTestFile };
