const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { stableConstitutionBlock } = require('./seniorEngineer');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractJson(text) {
  if (!text) throw new Error('Resposta vazia do LLM');
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('A resposta do LLM não é um JSON válido');
    return JSON.parse(match[0]);
  }
}

async function withRetries(fn, { retries = config.llmRetries, signal } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw new Error('Abortado');
    }
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (signal?.aborted || attempt === retries) break;
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

function resolveProvider(runConfig = {}) {
  if (runConfig.llmProvider) return String(runConfig.llmProvider).toLowerCase();
  if (runConfig.useOllama) return 'ollama';
  return config.defaultLlmProvider || 'ollama';
}

/** Modelos Gemini descontinuados → sucessor recomendado pela API. */
function resolveGeminiModel(requested) {
  const raw = String(requested || config.geminiModel || 'gemini-3.6-flash').trim();
  const deprecated = {
    'gemini-2.5-flash': 'gemini-3.6-flash',
    'gemini-2.0-flash': 'gemini-3.6-flash',
    'gemini-1.5-flash': 'gemini-3.6-flash',
    'gemini-2.5-flash-lite': 'gemini-3.6-flash',
    'gemini-3.1-flash-lite': 'gemini-3.6-flash'
  };
  return deprecated[raw] || raw;
}

async function callGemini({ system, user, apiKey, model, signal }) {
  const key = apiKey || config.geminiApiKey;
  if (!key) throw new Error('GEMINI_API_KEY não está configurada no servidor');

  const resolvedModel = resolveGeminiModel(model || config.geminiModel);
  // Auth keys (AQ.) do AI Studio: preferir header x-goog-api-key (não query string).
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: user }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Erro Gemini ${response.status}: ${body || response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = extractJson(text);
    const tokens = data.usageMetadata
      ? {
          prompt: data.usageMetadata.promptTokenCount || 0,
          completion: data.usageMetadata.candidatesTokenCount || 0,
          total: data.usageMetadata.totalTokenCount || 0
        }
      : { prompt: 0, completion: 0, total: 0 };

    return { data: parsed, tokens, provider: 'gemini', model: resolvedModel };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * OpenAI-compatible (OpenAI, Azure OpenAI, proxies Claude/GPT, etc.)
 */
async function callOpenAICompatible({ system, user, apiKey, baseUrl, model, signal }) {
  const key = apiKey || config.openaiApiKey;
  if (!key) throw new Error('OPENAI_API_KEY não está configurada no servidor');

  const root = (baseUrl || config.openaiBaseUrl).replace(/\/$/, '');
  const url = `${root}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model || config.openaiModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${user}\n\nReturn ONLY valid JSON.` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Erro OpenAI-compat ${response.status}: ${body || response.statusText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    const parsed = extractJson(text);
    const tokens = data.usage
      ? {
          prompt: data.usage.prompt_tokens || 0,
          completion: data.usage.completion_tokens || 0,
          total: data.usage.total_tokens || 0
        }
      : { prompt: 0, completion: 0, total: 0 };

    return {
      data: parsed,
      tokens,
      provider: 'openai',
      model: model || config.openaiModel
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOllama({ system, user, model, signal }) {
  const url = `${config.ollamaBaseUrl.replace(/\/$/, '')}/api/generate`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: model || config.ollamaDefaultModel,
        prompt: `${system}\n\n${user}\n\nReturn ONLY valid JSON.`,
        stream: false,
        format: 'json'
      })
    });

    if (!response.ok) {
      throw new Error(`Erro Ollama ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const parsed = extractJson(data.response);
    const tokens = {
      prompt: data.prompt_eval_count || 0,
      completion: data.eval_count || 0,
      total: (data.prompt_eval_count || 0) + (data.eval_count || 0)
    };
    return {
      data: parsed,
      tokens,
      provider: 'ollama',
      model: model || config.ollamaDefaultModel
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Anthropic Claude Messages API
 */
/**
 * Divide o system prompt já composto no prefixo fixo (constituição + regras, ver ADR-008) +
 * o restante específico da etapa. Reconstrói o prefixo esperado localmente (mesma função que
 * gerou o prompt) em vez de recebê-lo separado, pra não precisar mudar a assinatura de
 * composeSystemPrompt nem de nenhuma etapa que já chama generateJson({ system, ... }).
 */
function splitClaudeSystemForCache(system, runConfig) {
  const stable = stableConstitutionBlock(runConfig);
  if (typeof system === 'string' && system.startsWith(stable)) {
    return { stable, rest: system.slice(stable.length) };
  }
  return null;
}

async function callClaude({ system, user, apiKey, baseUrl, model, signal, runConfig }) {
  const key = apiKey || config.anthropicApiKey;
  if (!key) throw new Error('ANTHROPIC_API_KEY não está configurada no servidor');

  const root = (baseUrl || config.anthropicBaseUrl).replace(/\/$/, '');
  const url = `${root}/v1/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  // Prefixo fixo marcado como cache_control: chamadas seguintes dentro da mesma run (e mais
  // barato ainda entre etapas diferentes, já que o prefixo é o mesmo pra todas) reaproveitam
  // esse trecho por um preço bem menor em vez de reprocessá-lo do zero (ver ADR-008).
  const split = splitClaudeSystemForCache(system, runConfig || {});
  const systemPayload = split
    ? [
        { type: 'text', text: split.stable, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: split.rest }
      ]
    : system;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': config.anthropicVersion,
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model || config.anthropicModel,
        max_tokens: 8192,
        temperature: 0.2,
        system: systemPayload,
        messages: [
          {
            role: 'user',
            content: `${user}\n\nReturn ONLY valid JSON.`
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Erro Claude ${response.status}: ${body || response.statusText}`);
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
    const parsed = extractJson(text);
    // Num cache hit, usage.input_tokens já vem SEM o trecho cacheado — some do total sem
    // cache_creation_input_tokens (escrita no cache, 1ª chamada) e cache_read_input_tokens
    // (leitura do cache, chamadas seguintes, bem mais barato mas ainda processado).
    const cacheRead = data.usage?.cache_read_input_tokens || 0;
    const cacheWrite = data.usage?.cache_creation_input_tokens || 0;
    const promptTokens = (data.usage?.input_tokens || 0) + cacheRead + cacheWrite;
    const tokens = data.usage
      ? {
          prompt: promptTokens,
          completion: data.usage.output_tokens || 0,
          total: promptTokens + (data.usage.output_tokens || 0),
          cacheRead,
          cacheWrite
        }
      : { prompt: 0, completion: 0, total: 0 };

    return {
      data: parsed,
      tokens,
      provider: 'claude',
      model: model || config.anthropicModel
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Roda o cursor-agent (CLI headless) num diretório temporário descartável — nunca no repo do
 * ForjaIA nem no targetPath do projeto sendo forjado. Mesmo em --print, o CLI "has access to all
 * tools, including write and shell" (texto do próprio --help); isolar o cwd garante que qualquer
 * arquivo/comando que ele decida rodar não toque em nada real. Só o texto de stdout (`.result`)
 * é usado, exatamente como a resposta de um provedor de completion comum.
 */
function runCursorAgentCli(args, { cwd, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const bin = config.cursorBin;
    const env = { ...process.env, PATH: `${path.join(os.homedir(), '.local/bin')}:${process.env.PATH || ''}` };
    const child = spawn(bin, args, { cwd, env });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      fn(arg);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`cursor-agent excedeu o timeout de ${timeoutMs}ms`));
    }, timeoutMs);

    let onAbort;
    if (signal) {
      if (signal.aborted) {
        child.kill('SIGKILL');
        finish(reject, new Error('Abortado'));
      } else {
        onAbort = () => {
          child.kill('SIGKILL');
          finish(reject, new Error('Abortado'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => {
      finish(reject, new Error(`Falha ao executar ${bin}: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        finish(reject, new Error(`cursor-agent saiu com código ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      finish(resolve, stdout);
    });
  });
}

async function callCursorAgent({ system, user, apiKey, model, signal }) {
  const key = apiKey || config.cursorApiKey;
  const resolvedModel = model || config.cursorModel;
  const prompt = `${system}\n\n${user}\n\nReturn ONLY valid JSON.`;

  const args = ['-p', prompt, '--output-format', 'json', '--trust', '--model', resolvedModel];
  if (key) args.push('--api-key', key);

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cursor-'));
  try {
    const stdout = await runCursorAgentCli(args, {
      cwd: scratchDir,
      timeoutMs: config.llmTimeoutMs,
      signal
    });

    let envelope;
    try {
      envelope = JSON.parse(stdout);
    } catch {
      throw new Error('Resposta do cursor-agent não é um JSON válido');
    }
    if (envelope.is_error) {
      throw new Error(envelope.result || 'cursor-agent retornou erro');
    }

    const parsed = extractJson(envelope.result);
    const usage = envelope.usage || {};
    const tokens = {
      prompt: usage.inputTokens || 0,
      completion: usage.outputTokens || 0,
      total: (usage.inputTokens || 0) + (usage.outputTokens || 0)
    };

    return { data: parsed, tokens, provider: 'cursor', model: resolvedModel };
  } finally {
    fs.rm(scratchDir, { recursive: true, force: true }, () => {});
  }
}

async function checkCursorAgent() {
  try {
    const stdout = await runCursorAgentCli(['status'], {
      cwd: os.tmpdir(),
      timeoutMs: 3000
    });
    return { online: /logged in/i.test(stdout), detail: stdout.trim() };
  } catch (err) {
    return { online: false, detail: err.message };
  }
}

/**
 * Resolve JSON from Gemini, Claude, OpenAI-compatible ou Ollama.
 * Respeita o provedor escolhido; se falhar por crédito/auth, tenta fallbacks.
 */
function isRecoverableLlmError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    /credit balance|too low|billing|purchase credits|insufficient|quota|rate limit|resource_exhausted|429|401|403|permission_denied|invalid.?api.?key|authentication|unauthorized|econnrefused|fetch failed|timeout/.test(
      msg
    )
  );
}

async function callByProvider(provider, { system, user, runConfig, signal }) {
  if (provider === 'ollama') {
    return callOllama({
      system,
      user,
      model: runConfig.ollamaModel || config.ollamaDefaultModel,
      signal
    });
  }
  if (provider === 'cursor') {
    return callCursorAgent({
      system,
      user,
      model: runConfig.cursorModel || config.cursorModel,
      signal
    });
  }
  if (provider === 'openai') {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY não está configurada no servidor');
    return callOpenAICompatible({
      system,
      user,
      model: runConfig.openaiModel || config.openaiModel,
      baseUrl: runConfig.openaiBaseUrl || config.openaiBaseUrl,
      signal
    });
  }
  if (provider === 'claude') {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY não está configurada no servidor');
    return callClaude({
      system,
      user,
      model: runConfig.claudeModel || runConfig.anthropicModel || config.anthropicModel,
      baseUrl: runConfig.anthropicBaseUrl || config.anthropicBaseUrl,
      signal,
      runConfig
    });
  }
  // gemini (default)
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY não está configurada no servidor');
  return callGemini({
    system,
    user,
    model: runConfig.geminiModel || config.geminiModel,
    signal
  });
}

function fallbackProviders(primary) {
  const order = [];
  const push = (p) => {
    if (!order.includes(p)) order.push(p);
  };
  push(primary);
  // Após falha de quota cloud, Ollama local primeiro (Claude/Gemini pagos costumam falhar juntos)
  push('ollama');
  if (config.defaultLlmProvider) push(String(config.defaultLlmProvider).toLowerCase());
  if (config.geminiApiKey) push('gemini');
  if (config.openaiApiKey) push('openai');
  // Claude por último: billing costuma falhar sem créditos
  if (config.anthropicApiKey) push('claude');
  return order;
}

async function generateJson({ system, user, runConfig = {}, signal }) {
  const primary = resolveProvider(runConfig);
  const chain = fallbackProviders(primary);
  let lastError = null;

  return withRetries(
    async () => {
      for (const provider of chain) {
        try {
          // Skip providers that clearly cannot run
          if (provider === 'gemini' && !config.geminiApiKey) continue;
          if (provider === 'claude' && !config.anthropicApiKey) continue;
          if (provider === 'openai' && !config.openaiApiKey) continue;

          const result = await callByProvider(provider, { system, user, runConfig, signal });
          if (provider !== primary && lastError) {
            result.fallbackFrom = primary;
            result.fallbackReason = String(lastError.message || lastError).slice(0, 240);
            console.warn(
              `[llm] Fallback ${primary} → ${provider}: ${result.fallbackReason}`
            );
          }
          return result;
        } catch (err) {
          lastError = err;
          if (provider === primary && !isRecoverableLlmError(err)) {
            throw err;
          }
          // recoverable or already past primary → try next
          continue;
        }
      }
      if (!config.allowMocks) {
        throw new Error(
          lastError?.message ||
            `Nenhum LLM disponível. Defina GEMINI_API_KEY / OPENAI / ANTHROPIC ou use Ollama.`
        );
      }
      throw lastError || new Error('Nenhum LLM disponível');
    },
    { signal }
  );
}

async function checkOllama() {
  try {
    const res = await fetch(`${config.ollamaBaseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) return { online: false, models: [] };
    const data = await res.json();
    return {
      online: true,
      models: (data.models || []).map((m) => m.name)
    };
  } catch {
    return { online: false, models: [] };
  }
}

function providerStatus() {
  return {
    default: config.defaultLlmProvider,
    gemini: { configured: Boolean(config.geminiApiKey), model: config.geminiModel },
    claude: {
      configured: Boolean(config.anthropicApiKey),
      model: config.anthropicModel,
      baseUrl: config.anthropicBaseUrl
    },
    openai: {
      configured: Boolean(config.openaiApiKey),
      model: config.openaiModel,
      baseUrl: config.openaiBaseUrl
    },
    ollama: { baseUrl: config.ollamaBaseUrl, model: config.ollamaDefaultModel },
    cursor: { configured: Boolean(config.cursorApiKey), model: config.cursorModel }
  };
}

/**
 * Verifica se o provedor LLM selecionado responde (sem gastar tokens de geração).
 */
async function probeLlm(providerInput) {
  const provider = String(providerInput || config.defaultLlmProvider || 'ollama').toLowerCase();
  const started = Date.now();

  if (provider === 'ollama') {
    const ollama = await checkOllama();
    return {
      provider: 'ollama',
      model: config.ollamaDefaultModel,
      ok: ollama.online,
      configured: true,
      latencyMs: Date.now() - started,
      detail: ollama.online
        ? `Ollama online (${ollama.models.length} modelo(s))`
        : 'Ollama offline — inicie o daemon local'
    };
  }

  if (provider === 'gemini') {
    if (!config.geminiApiKey) {
      return {
        provider: 'gemini',
        model: config.geminiModel,
        ok: false,
        configured: false,
        latencyMs: Date.now() - started,
        detail: 'GEMINI_API_KEY não configurada'
      };
    }
    const model = resolveGeminiModel(config.geminiModel);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
      const res = await fetch(url, {
        headers: { 'x-goog-api-key': config.geminiApiKey },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          provider: 'gemini',
          model,
          ok: false,
          configured: true,
          latencyMs: Date.now() - started,
          detail: `Gemini ${res.status}: ${body.slice(0, 180) || res.statusText}`
        };
      }
      return {
        provider: 'gemini',
        model,
        ok: true,
        configured: true,
        latencyMs: Date.now() - started,
        detail: 'Gemini operacional'
      };
    } catch (err) {
      return {
        provider: 'gemini',
        model,
        ok: false,
        configured: true,
        latencyMs: Date.now() - started,
        detail: err.message || 'Falha ao contactar Gemini'
      };
    }
  }

  if (provider === 'claude') {
    const ok = Boolean(config.anthropicApiKey);
    return {
      provider: 'claude',
      model: config.anthropicModel,
      ok,
      configured: ok,
      latencyMs: Date.now() - started,
      detail: ok ? 'Claude configurado no servidor' : 'ANTHROPIC_API_KEY não configurada'
    };
  }

  if (provider === 'openai') {
    const ok = Boolean(config.openaiApiKey);
    return {
      provider: 'openai',
      model: config.openaiModel,
      ok,
      configured: ok,
      latencyMs: Date.now() - started,
      detail: ok ? 'OpenAI-compat configurado no servidor' : 'OPENAI_API_KEY não configurada'
    };
  }

  if (provider === 'cursor') {
    if (config.cursorApiKey) {
      return {
        provider: 'cursor',
        model: config.cursorModel,
        ok: true,
        configured: true,
        latencyMs: Date.now() - started,
        detail: 'CURSOR_API_KEY configurada no servidor'
      };
    }
    const status = await checkCursorAgent();
    return {
      provider: 'cursor',
      model: config.cursorModel,
      ok: status.online,
      configured: status.online,
      latencyMs: Date.now() - started,
      detail: status.online ? status.detail : `Sem CURSOR_API_KEY e ${status.detail}. Rode 'cursor-agent login'.`
    };
  }

  return {
    provider,
    model: null,
    ok: false,
    configured: false,
    latencyMs: Date.now() - started,
    detail: `Provedor desconhecido: ${provider}`
  };
}

module.exports = {
  generateJson,
  callGemini,
  callClaude,
  callOpenAICompatible,
  callOllama,
  callCursorAgent,
  checkOllama,
  checkCursorAgent,
  extractJson,
  resolveProvider,
  resolveGeminiModel,
  providerStatus,
  probeLlm
};
