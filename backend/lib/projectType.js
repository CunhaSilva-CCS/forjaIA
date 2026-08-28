/**
 * Detecta se o projeto é um app mobile Expo/React Native — o pipeline inteiro (QA via HTTP,
 * Dockerfile, deploy via container/porta) pressupõe um serviço web, o que não existe num app
 * mobile puro. Usado por qa.js e devops.js pra desviar pro caminho mobile (ver ADR-014) em vez
 * de tentar Dockerizar/testar via HTTP algo que não é um servidor.
 */
function detectProjectType(files) {
  const pkgFile = (files || []).find((f) => f.path === 'package.json');
  if (!pkgFile) return 'web';

  let pkg;
  try {
    pkg = JSON.parse(pkgFile.content || '{}');
  } catch {
    return 'web';
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (!deps.expo && !deps['react-native']) return 'web';

  return 'mobile-expo';
}

module.exports = { detectProjectType };
