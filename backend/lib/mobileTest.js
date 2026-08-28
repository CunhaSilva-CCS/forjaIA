/**
 * QA para projetos mobile Expo/React Native (ver ADR-014): não existe servidor HTTP pra testar
 * como o resto do pipeline pressupõe, então roda a suíte de testes real do próprio projeto
 * (Jest, já presente em qualquer app Expo/RN padrão) e traduz o resultado pro mesmo formato
 * { passed, tests: [{ name, passed, error }] } que agent/qa.js já usa pros testes via HTTP —
 * o resto do pipeline (relatório, ADR-012 de confiabilidade) não precisa saber a diferença.
 */
const { execAsync } = require('./dockerBuild');

function parseJestJson(raw) {
  const trimmed = String(raw || '').trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Saída do Jest não contém JSON');
  return JSON.parse(match[0]);
}

function toReport(jestResult) {
  const tests = [];
  for (const suite of jestResult.testResults || []) {
    for (const assertion of suite.assertionResults || []) {
      if (assertion.status === 'pending' || assertion.status === 'skipped') continue;
      tests.push({
        name: assertion.fullName || assertion.title,
        passed: assertion.status === 'passed',
        error: assertion.status === 'passed' ? null : (assertion.failureMessages || []).join('\n').slice(0, 2000)
      });
    }
  }
  return {
    passed: Boolean(jestResult.success) && tests.every((t) => t.passed),
    tests
  };
}

async function runNativeTestSuite(projectDir, orchestrator) {
  orchestrator.log('qa', 'Projeto mobile detectado — rodando a suíte de testes nativa (Jest) em vez de HTTP.', 'info');
  try {
    const { stdout } = await execAsync('npx jest --json --testLocation=false', { cwd: projectDir });
    return toReport(parseJestJson(stdout));
  } catch (err) {
    // Jest sai com código != 0 quando há teste falho — isso não é falha de execução, é o
    // resultado normal a reportar. Só trata como erro de fato se não conseguir nem parsear.
    if (err.stdout) {
      try {
        return toReport(parseJestJson(err.stdout));
      } catch {
        // cai para o erro genérico abaixo
      }
    }
    orchestrator.log('qa', `Falha ao rodar a suíte de testes nativa: ${err.message}`, 'error');
    return {
      passed: false,
      tests: [{ name: 'Execução da suíte de testes (Jest)', passed: false, error: err.message }]
    };
  }
}

module.exports = { runNativeTestSuite, parseJestJson, toReport };
