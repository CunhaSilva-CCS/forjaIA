const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../lib/config');
const { resolveWithinWorkspace, safeRmDir } = require('../lib/paths');
const deployRuntime = require('../lib/deployRuntime');
const { scanEnvVarNames } = require('../lib/envScan');

/** Variável nova que o código passou a exigir (ex.: introduzida por uma cura) e nunca foi
 * declarada em .env.example nem em JWT_SECRET/CORS_ORIGIN especiais — gera um valor real
 * (não é sandbox descartável; é o app que o usuário vai efetivamente rodar). */
function realValueFor(key) {
  const isSecretLike = /SECRET|KEY|TOKEN|PASSWORD/i.test(key);
  return isSecretLike ? crypto.randomBytes(32).toString('hex') : 'change-me';
}

module.exports = {
  prepareSandbox: async (files, runConfig, orchestrator) => {
    const { announceThinking } = require('../lib/seniorEngineer');
    announceThinking(orchestrator, 'devops');
    orchestrator.log('devops', 'Preparando sandbox e validando grafo de pacotes...', 'info');
    const runner = require('../sandbox/runner');
    const sandbox = await runner.start(files, orchestrator);
    return sandbox;
  },

  cleanupSandbox: async (sandboxConfig, orchestrator) => {
    orchestrator.log('devops', 'Limpando sandbox...', 'info');
    const runner = sandboxConfig?.runner || require('../sandbox/runner');
    await runner.stop(orchestrator);
    orchestrator.log('devops', 'Sandbox limpa.', 'success');
  },

  killDeploy: async () => {
    await deployRuntime.stopDeploy();
  },

  /** Projeto mobile Expo/RN: sem servidor HTTP pra fazer container/porta — o "deploy" real é
   * compilar e instalar no Simulador de iPhone (ver ADR-014). */
  deployMobile: async (files, runConfig, orchestrator) => {
    const isValidate = runConfig.mode === 'validate';
    const relativeTarget =
      runConfig.targetPath || (isValidate ? runConfig.sourcePath : null) || 'deployed';
    const deployDir = resolveWithinWorkspace(relativeTarget);
    orchestrator.log('devops', `Projeto mobile: implantando no Simulador a partir de ${relativeTarget}.`, 'info');

    const writeSafely = (file) => {
      if (!file?.path || typeof file.content !== 'string') return;
      const fullPath = path.join(deployDir, file.path);
      const rel = path.relative(deployDir, fullPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Recusando gravar fora do diretório de deploy: ${file.path}`);
      }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content, 'utf8');
    };

    if (!isValidate) {
      if (fs.existsSync(deployDir)) safeRmDir(deployDir);
      fs.mkdirSync(deployDir, { recursive: true });
      for (const file of files) writeSafely(file);
    } else if (!fs.existsSync(deployDir)) {
      throw new Error(`Projeto a validar não encontrado: ${relativeTarget}`);
    } else if (Array.isArray(files) && files.length) {
      // Sincroniza só arquivos curados/modificados no projeto já existente — não reescreve tudo
      // (evita sobrescrever node_modules/config do projeto real do usuário sem necessidade).
      for (const file of files) writeSafely(file);
    }

    // Simulador de iPhone e emulador Android são sempre tentados (par padrão de qualquer projeto
    // Expo/RN — ADR-014/ADR-031) — Mac (Catalyst) e Windows (GitHub Actions) são adicionais
    // opcionais (ADR-018): tentados só quando o projeto já tem o suporte configurado, e uma falha
    // num alvo não derruba os outros.
    const { deployToSimulator, deployToMac, supportsMacCatalyst } = require('../lib/mobileDeploy');
    const { deployToAndroidEmulator } = require('../lib/androidDeploy');
    const { supportsWindows, triggerWindowsBuild } = require('../lib/windowsDeploy');

    const targets = [];
    try {
      const simResult = await deployToSimulator({ projectDir: deployDir, orchestrator });
      targets.push({ platform: 'ios-simulator', ok: true, ...simResult });
    } catch (err) {
      orchestrator.log('devops', `Deploy no Simulador iOS falhou: ${err.message}`, 'warning');
      targets.push({ platform: 'ios-simulator', ok: false, error: err.message });
    }

    try {
      const androidResult = await deployToAndroidEmulator({ projectDir: deployDir, orchestrator });
      targets.push({ platform: 'android-emulator', ok: true, ...androidResult });
    } catch (err) {
      orchestrator.log('devops', `Deploy no emulador Android falhou: ${err.message}`, 'warning');
      targets.push({ platform: 'android-emulator', ok: false, error: err.message });
    }

    if (await supportsMacCatalyst(deployDir)) {
      try {
        const macResult = await deployToMac({ projectDir: deployDir, orchestrator });
        targets.push({ platform: 'macos', ok: true, ...macResult });
      } catch (err) {
        orchestrator.log('devops', `Deploy macOS falhou: ${err.message}`, 'warning');
        targets.push({ platform: 'macos', ok: false, error: err.message });
      }
    } else {
      orchestrator.log('devops', 'macOS: Mac Catalyst não habilitado neste projeto — pulando.', 'info');
    }

    if (supportsWindows(deployDir)) {
      try {
        const winResult = await triggerWindowsBuild({ projectDir: deployDir, orchestrator });
        targets.push({ platform: 'windows', ok: true, ...winResult });
      } catch (err) {
        orchestrator.log('devops', `Build Windows falhou: ${err.message}`, 'warning');
        targets.push({ platform: 'windows', ok: false, error: err.message });
      }
    } else {
      orchestrator.log('devops', 'Windows: sem scaffolding/workflow configurado neste projeto — pulando.', 'info');
    }

    return {
      url: null,
      path: relativeTarget,
      runtime: 'multi-platform',
      targets
    };
  },

  deploy: async (files, runConfig, orchestrator) => {
    const { announceThinking, thinkAsSenior } = require('../lib/seniorEngineer');
    const { defaultDockerfile, defaultDockerignore, defaultEnvExample } = require('../lib/productionChecklist');
    announceThinking(orchestrator, 'devops');

    const { detectProjectType } = require('../lib/projectType');
    if (detectProjectType(files) === 'mobile-expo') {
      return module.exports.deployMobile(files, runConfig, orchestrator);
    }

    const isValidate = runConfig.mode === 'validate';
    const relativeTarget =
      runConfig.targetPath || (isValidate ? runConfig.sourcePath : null) || 'deployed';
    const deployDir = resolveWithinWorkspace(relativeTarget);
    orchestrator.log('devops', `Implantando no caminho do workspace: ${relativeTarget}`, 'info');

    // Artefatos mínimos no grafo de arquivos (a runtime também gera Dockerfile no build da imagem)
    const byPath = new Map((files || []).map((f) => [String(f.path || '').replace(/\\/g, '/'), f]));
    const ensureFile = (p, content) => {
      if (!byPath.has(p)) {
        byPath.set(p, { name: path.basename(p), path: p, content });
      }
    };
    ensureFile('Dockerfile', defaultDockerfile(config.deployHostPort));
    ensureFile('.dockerignore', defaultDockerignore());
    if (!byPath.has('.env.example')) {
      ensureFile('.env.example', defaultEnvExample(config.deployHostPort));
    } else {
      const envEx = String(byPath.get('.env.example').content || '');
      if (!/^PORT=/m.test(envEx) && !/\nPORT=/m.test(envEx)) {
        byPath.set('.env.example', {
          ...byPath.get('.env.example'),
          content: `${envEx.trim()}\nPORT=${config.deployHostPort}\n`
        });
      }
    }
    files = [...byPath.values()];

    const hasPkg = byPath.has('package.json');
    const hasStart =
      hasPkg &&
      (() => {
        try {
          const pkg = JSON.parse(byPath.get('package.json').content || '{}');
          return Boolean(pkg.scripts?.start || pkg.main);
        } catch {
          return false;
        }
      })();

    const preflight = await thinkAsSenior({
      role: 'devops',
      taskContract: `Pré-voo de deploy local como SRE sênior.
A ForjaIA SEMPRE gera/reescreve o Dockerfile de produção no deploy (porta interna 3000).
Não reprove só por "falta de Dockerfile" se package.json tiver script start/main e .env.example tiver PORT.
Só marque ready=false se faltar entrypoint real (package.json/start) ou houver risco crítico óbvio.
Retorne APENAS JSON:
{
  "ready": true,
  "summary": "1-2 frases",
  "checklist": ["item ok ou risco"],
  "warnings": ["aviso operacional"]
}`,
      userPayload: {
        mode: runConfig.mode || 'forge',
        target: relativeTarget,
        files: (files || []).map((f) => f.path),
        facts: {
          hasPackageJson: hasPkg,
          hasStartScriptOrMain: hasStart,
          hasDockerfile: byPath.has('Dockerfile'),
          hasEnvExample: byPath.has('.env.example'),
          forjaGeneratesDockerfile: true,
          deployHostPort: config.deployHostPort,
          containerPort: 3000
        },
        deployPort: config.deployHostPort,
        requireDocker: config.requireDocker
      },
      runConfig,
      orchestrator
    });
    if (preflight?.summary) {
      orchestrator.log(
        'devops',
        `Pré-voo: ${preflight.summary}`,
        preflight.ready === false ? 'warning' : 'info'
      );
    }
    if (Array.isArray(preflight?.warnings)) {
      for (const w of preflight.warnings.slice(0, 4)) {
        orchestrator.log('devops', `Aviso: ${w}`, 'warning');
      }
    }
    // Fail-closed estrutural; não bloqueie só porque o LLM pediu Dockerfile (a forja gera).
    if (preflight && preflight.ready === false && !config.allowMocks) {
      const summary = String(preflight.summary || '');
      const dockerfileOnlyComplaint =
        hasStart &&
        /dockerfile|PORT|porta/i.test(summary) &&
        !/sem package\.json|missing package\.json|sem script start|entrypoint ausente|não inicia|cannot start/i.test(
          summary
        );
      // O próprio LLM às vezes alucina "workspace vazio" mesmo com hasStart confirmado
      // deterministicamente a partir do package.json real (visto nesta sessão: o pré-voo
      // reprovou duas vezes seguidas por "nenhum artefato encontrado" enquanto os arquivos
      // já estavam escritos em disco). hasStart não vem do LLM — vem do parse local do
      // package.json — então é mais confiável que a alegação do próprio pré-voo.
      const emptyWorkspaceFalsePositive =
        hasStart && files.length > 3 && /vazio|empty|nenhum arquivo|no files|not.*found/i.test(summary);
      if (dockerfileOnlyComplaint || emptyWorkspaceFalsePositive) {
        orchestrator.log(
          'devops',
          `Pré-voo LLM marcou não-pronto (${dockerfileOnlyComplaint ? 'Dockerfile/PORT' : 'alegação de workspace vazio'}) — seguindo, package.json/start já confirmados localmente. Motivo: ${summary}`,
          'warning'
        );
      } else if (!hasStart) {
        throw new Error(
          `Pré-voo de deploy reprovado (produção fail-closed): ${summary || 'faltam package.json/start'}`
        );
      } else {
        throw new Error(
          `Pré-voo de deploy reprovado (produção fail-closed): ${summary || 'não pronto'}`
        );
      }
    }

    await deployRuntime.stopDeploy(orchestrator);

    // Em validação, preservar o projeto existente (dados, Dockerfile, node_modules).
    if (!isValidate) {
      if (fs.existsSync(deployDir)) {
        safeRmDir(deployDir);
      }
      fs.mkdirSync(deployDir, { recursive: true });

      for (const file of files) {
        if (!file?.path) continue;
        const fullPath = path.join(deployDir, file.path);
        const rel = path.relative(deployDir, fullPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error(`Recusando gravar fora do diretório de deploy: ${file.path}`);
        }
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content || '', 'utf8');
      }
    } else if (!fs.existsSync(deployDir)) {
      throw new Error(`Projeto a validar não encontrado: ${relativeTarget}`);
    } else if (Array.isArray(files) && files.length) {
      let written = 0;
      for (const file of files) {
        if (!file?.path || typeof file.content !== 'string') continue;
        const fullPath = path.join(deployDir, file.path);
        const rel = path.relative(deployDir, fullPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error(`Recusando gravar fora do diretório de deploy: ${file.path}`);
        }
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf8');
        written += 1;
      }
      if (written) {
        orchestrator.log(
          'devops',
          `Sincronizados ${written} arquivo(s) curado(s) no projeto pronto.`,
          'info'
        );
      }
    }

    const envPath = path.join(deployDir, '.env');
    const secureJwtSecret =
      process.env.JWT_SECRET ||
      (fs.existsSync(envPath)
        ? (fs.readFileSync(envPath, 'utf8').match(/^JWT_SECRET=(.+)$/m) || [])[1]?.trim()
        : null) ||
      crypto.randomBytes(32).toString('hex');

    // Cobre variável nova que o código passou a exigir (ex.: SESSION_SECRET introduzida por
    // uma cura) e nunca foi declarada em .env.example — sem isso o processo de deploy sobe
    // e crasha na primeira leitura de process.env que faltar.
    const scannedEnvNames = scanEnvVarNames(files);

    if (isValidate && fs.existsSync(envPath)) {
      const existing = fs.readFileSync(envPath, 'utf8');
      const lines = existing.split(/\r?\n/).filter((l) => l.trim() !== '');
      const map = new Map();
      for (const line of lines) {
        const i = line.indexOf('=');
        if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 1));
      }
      // Host port for docs/local; container forces PORT=3000 internamente.
      map.set('PORT', String(config.deployHostPort));
      if (!map.has('HOST')) map.set('HOST', '0.0.0.0');
      if (!map.has('JWT_SECRET')) map.set('JWT_SECRET', secureJwtSecret);
      if (!map.has('NODE_ENV')) map.set('NODE_ENV', 'production');
      for (const key of scannedEnvNames) {
        if (!map.has(key)) map.set(key, realValueFor(key));
      }
      const merged = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      fs.writeFileSync(envPath, merged, 'utf8');
      orchestrator.log('devops', 'Preservado .env do projeto; PORT ajustado para deploy.', 'info');
    } else {
      // Default é a própria origem do app implantado (porta do deploy), não a do ForjaIA —
      // reaproveitar config.corsOrigin aqui bloqueava o front do app recém-implantado de
      // chamar sua própria API, já que o ForjaIA roda numa porta completamente diferente.
      const corsOrigin = `http://127.0.0.1:${config.deployHostPort}`;
      const map = new Map([
        ['PORT', String(config.deployHostPort)],
        ['HOST', '0.0.0.0'],
        ['JWT_SECRET', secureJwtSecret],
        ['NODE_ENV', 'production'],
        ['CORS_ORIGIN', corsOrigin]
      ]);
      for (const key of scannedEnvNames) {
        if (!map.has(key)) map.set(key, realValueFor(key));
      }
      const envContent = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      fs.writeFileSync(envPath, envContent, 'utf8');
    }

    const fileEnv = Object.fromEntries(
      fs.existsSync(envPath)
        ? fs
            .readFileSync(envPath, 'utf8')
            .split(/\r?\n/)
            .filter((l) => l.includes('='))
            .map((l) => {
              const i = l.indexOf('=');
              return [l.slice(0, i).trim(), l.slice(i + 1)];
            })
        : []
    );

    const hostPort =
      (runConfig.environment || fileEnv.FORJA_ENVIRONMENT) === 'staging'
        ? config.stagingHostPort
        : config.deployHostPort;

    const result = await deployRuntime.startDeploy({
      deployDir,
      hostPort,
      env: {
        ...fileEnv,
        JWT_SECRET: fileEnv.JWT_SECRET || secureJwtSecret,
        NODE_ENV: fileEnv.NODE_ENV || 'production',
        CORS_ORIGIN:
          fileEnv.CORS_ORIGIN && fileEnv.CORS_ORIGIN !== '*'
            ? fileEnv.CORS_ORIGIN
            : `http://127.0.0.1:${hostPort}`,
        FORJA_ENVIRONMENT: runConfig.environment === 'staging' ? 'staging' : 'local'
      },
      orchestrator
    });

    orchestrator.log(
      'devops',
      `Deploy pronto (${result.type}) em ${result.url}.`,
      'success'
    );

    return {
      url: result.url,
      path: relativeTarget,
      runtime: result.type,
      containerId: result.containerId || null,
      image: result.image || null
    };
  }
};
