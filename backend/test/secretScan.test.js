const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scanForHardcodedSecrets } = require('../lib/secretScan');

describe('scanForHardcodedSecrets (ADR-011)', () => {
  it('detecta chave da Anthropic por formato, independente do nome da variável', () => {
    const files = [{ path: 'src/client.js', content: 'const x = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890";' }];
    const issues = scanForHardcodedSecrets(files);
    assert.ok(issues.some((i) => i.id === 'SEC-TOKEN-ANTHROPIC'));
  });

  it('detecta AWS Access Key ID e bloco de chave privada', () => {
    const files = [
      { path: 'a.js', content: 'const key = "AKIAABCDEFGHIJKLMNOP";' },
      { path: 'b.pem', content: '-----BEGIN RSA PRIVATE KEY-----\nMIIB...\n-----END RSA PRIVATE KEY-----' }
    ];
    const issues = scanForHardcodedSecrets(files);
    assert.ok(issues.some((i) => i.id === 'SEC-TOKEN-AWS'));
    assert.ok(issues.some((i) => i.id === 'SEC-PRIVATE-KEY'));
  });

  it('detecta atribuição suspeita além do nome de variável exato (camelCase, objeto literal)', () => {
    const files = [
      { path: 'src/db.js', content: 'const dbPassword = "hunter2_real_password";' },
      { path: 'src/config.js', content: 'module.exports = { stripeApiKey: "literal_value_here" };' }
    ];
    const issues = scanForHardcodedSecrets(files);
    assert.ok(issues.some((i) => i.id === 'SEC-SECRET-JS-BROAD'));
    assert.ok(issues.some((i) => i.id === 'SEC-SECRET-OBJECT-LITERAL'));
  });

  it('não sinaliza quando o valor vem de process.env', () => {
    const files = [{ path: 'src/config.js', content: 'const apiKey = process.env.API_KEY || "";' }];
    const issues = scanForHardcodedSecrets(files);
    assert.equal(issues.length, 0);
  });

  it('detecta valor real commitado em arquivo .env, mas não em .env.example', () => {
    const realEnv = [{ path: '.env', content: 'DATABASE_PASSWORD=superSecretValue123' }];
    const exampleEnv = [{ path: '.env.example', content: 'DATABASE_PASSWORD=altere-para-um-valor-seguro' }];

    const realIssues = scanForHardcodedSecrets(realEnv);
    const exampleIssues = scanForHardcodedSecrets(exampleEnv);

    assert.ok(realIssues.some((i) => i.id === 'SEC-SECRET-ENV-FILE'));
    assert.ok(!exampleIssues.some((i) => i.id === 'SEC-SECRET-ENV-FILE'));
  });

  it('não duplica o mesmo achado repetido no mesmo arquivo', () => {
    const files = [{ path: 'a.js', content: 'const t1 = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890";\nconst t2 = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890";' }];
    const issues = scanForHardcodedSecrets(files);
    assert.equal(issues.filter((i) => i.id === 'SEC-TOKEN-ANTHROPIC').length, 1);
  });
});
