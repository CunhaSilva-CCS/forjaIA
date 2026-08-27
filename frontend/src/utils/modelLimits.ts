import type { LlmProvider } from '../types/agent';

export type ModelLimitInfo = {
  contextWindow: number;
  maxOutput: number;
  label: string;
  source: 'known' | 'estimate';
};

const KNOWN: Array<{ match: RegExp; contextWindow: number; maxOutput: number }> = [
  { match: /gemini-3\.|gemini-2\.5|gemini-2\.0|gemini-1\.5-flash/i, contextWindow: 1_048_576, maxOutput: 65_536 },
  { match: /gemini-1\.5-pro/i, contextWindow: 2_097_152, maxOutput: 8192 },
  { match: /gemini/i, contextWindow: 1_048_576, maxOutput: 8192 },
  { match: /claude-opus-4|claude-sonnet-4|claude-3-7|claude-3\.5|claude-3-5/i, contextWindow: 200_000, maxOutput: 64_000 },
  { match: /claude/i, contextWindow: 200_000, maxOutput: 8192 },
  { match: /gpt-4\.1/i, contextWindow: 1_047_576, maxOutput: 32_768 },
  { match: /gpt-4o-mini/i, contextWindow: 128_000, maxOutput: 16_384 },
  { match: /gpt-4o/i, contextWindow: 128_000, maxOutput: 16_384 },
  { match: /o3|o1/i, contextWindow: 200_000, maxOutput: 100_000 },
  { match: /gpt-4/i, contextWindow: 128_000, maxOutput: 8192 },
  { match: /qwen2\.5.*32b|qwen2\.5-coder:32/i, contextWindow: 32_768, maxOutput: 8192 },
  { match: /qwen2\.5|qwen/i, contextWindow: 32_768, maxOutput: 8192 },
  { match: /llama3\.1|llama-3\.1/i, contextWindow: 128_000, maxOutput: 8192 },
  { match: /llama3|llama-3/i, contextWindow: 8192, maxOutput: 4096 },
  { match: /mistral|mixtral/i, contextWindow: 32_768, maxOutput: 8192 },
  { match: /deepseek/i, contextWindow: 64_000, maxOutput: 8192 }
];

const PROVIDER_FALLBACK: Record<LlmProvider, { contextWindow: number; maxOutput: number }> = {
  gemini: { contextWindow: 1_048_576, maxOutput: 65_536 },
  claude: { contextWindow: 200_000, maxOutput: 64_000 },
  openai: { contextWindow: 128_000, maxOutput: 16_384 },
  ollama: { contextWindow: 32_768, maxOutput: 8192 },
  // "auto"/modelo escolhido pelo próprio Cursor — sem um nome fixo pra casar no KNOWN,
  // estimativa conservadora alinhada aos modelos grandes que ele costuma rotear.
  cursor: { contextWindow: 200_000, maxOutput: 64_000 }
};

export function resolveModelLimits(
  provider: LlmProvider,
  modelName: string | null | undefined
): ModelLimitInfo {
  const name = (modelName || '').trim();
  for (const entry of KNOWN) {
    if (name && entry.match.test(name)) {
      return {
        contextWindow: entry.contextWindow,
        maxOutput: entry.maxOutput,
        label: name,
        source: 'known'
      };
    }
  }
  const fb = PROVIDER_FALLBACK[provider];
  return {
    contextWindow: fb.contextWindow,
    maxOutput: fb.maxOutput,
    label: name || provider,
    source: 'estimate'
  };
}

export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 2)}M`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return v.toLocaleString('pt-PT');
}

export function pct(used: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 1000) / 10);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
}
