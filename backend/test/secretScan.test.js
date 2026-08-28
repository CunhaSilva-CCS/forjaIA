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

  it('achado real: detecta DOIS segredos DISTINTOS do mesmo tipo no mesmo arquivo (regex sem flag "g" só pegava o primeiro)', () => {
    const files = [
      {
        path: 'a.js',
        content:
          'const t1 = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890";\nconst t2 = "sk-ant-api03-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";'
      }
    ];
    const issues = scanForHardcodedSecrets(files);
    assert.equal(issues.filter((i) => i.id === 'SEC-TOKEN-ANTHROPIC').length, 2);
  });

  // Regressão real: achado ao validar o secPass (app real de terceiro) — três falsos positivos
  // concretos que a checagem heurística estava gerando.
  it('não sinaliza fixture de teste com senha literal (arquivo __tests__/*.test.js)', () => {
    const files = [{ path: '__tests__/account.test.js', content: 'const password = "Abc!2345";' }];
    assert.deepEqual(scanForHardcodedSecrets(files), []);
  });

  it('não sinaliza constante cujo NOME contém "secret" mas o VALOR é uma frase (mensagem de erro)', () => {
    const files = [
      {
        path: 'src/services/storage.js',
        content: 'const VAULT_SECRET_REQUIRED =\n  "Nao e possivel salvar o cofre sem a senha de acesso.";'
      }
    ];
    assert.deepEqual(scanForHardcodedSecrets(files), []);
  });

  it('não sinaliza "chave:valor" que na verdade é um ternário ou member access, não objeto literal', () => {
    const files = [
      { path: 'src/components/PasswordCard.js', content: '{showPassword ? item.password : "••••••••••"}' }
    ];
    assert.deepEqual(scanForHardcodedSecrets(files), []);
  });

  it('formato de token conhecido continua detectado mesmo em arquivo de teste', () => {
    const files = [{ path: '__tests__/leak.test.js', content: 'const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890";' }];
    const issues = scanForHardcodedSecrets(files);
    assert.ok(issues.some((i) => i.id === 'SEC-TOKEN-ANTHROPIC'));
  });
});
