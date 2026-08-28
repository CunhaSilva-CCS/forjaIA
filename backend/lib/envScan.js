/**
 * Varre o conteúdo de arquivos gerados por `process.env.NOME` — cobre o caso comum de uma
 * cura/correção introduzir uma variável nova (ex.: SESSION_SECRET) sem declará-la em
 * .env.example, o que faz o container (sandbox ou deploy) crashar na primeira leitura.
 */
function scanEnvVarNames(files) {
  const names = new Set();
  for (const file of files || []) {
    const content = String(file?.content || '');
    for (const match of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

module.exports = { scanEnvVarNames };
