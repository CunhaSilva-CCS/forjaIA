# ADR-010 — Modelo econômico na camada de revisão sênior, entregável intocado

**Status:** Aceito

## Contexto

O usuário pediu inteligência pra ForjaIA escolher automaticamente qual modelo de IA usar visando
economia de tokens. Levantamento dos 12 pontos de chamada de LLM no pipeline (`generateJson(...)`
em `agent/*.js` + `thinkAsSenior` em `lib/seniorEngineer.js`) mostrou uma divisão natural já
existente na arquitetura:

- **Entregável primário** (`architect`, `coder`, `debugger`, `healer`, `userFix`, chamada principal
  de `human`): o resultado da chamada É o que o resto do pipeline usa/executa. Um modelo mais fraco
  aqui arrisca gerar diagnóstico ou código pior, disparando mais ciclos de QA→Cura→retry — o que
  pode gastar *mais* tokens no total do que economiza por chamada.
- **Revisão sênior opcional** (`thinkAsSenior`, usada por `security`, `qa`, `devops` preflight,
  `reporter`, e uma segunda chamada de `human`): por design já é best-effort — o próprio código de
  `thinkAsSenior` cai em `null` silenciosamente se o LLM falhar, e as etapas que a chamam já têm
  lógica heurística própria que funciona sozinha. É a superfície certa pra usar um modelo mais
  barato: 5 das 12 chamadas por run, sem tocar na qualidade do que o pipeline efetivamente produz.

## Decisão

`generateJson({ ..., tier })` aceita `tier: 'premium' | 'economy'` (default `'premium'`, então todo
call site existente continua com o modelo de sempre sem precisar mudar nada). Só
`thinkAsSenior` passa `tier: 'economy'`.

`lib/llm.js` ganha `resolveTierModel(provider, tier, runConfig)`: resolve pro modelo econômico do
provedor (`config.<provider>ModelEconomy`) quando `tier === 'economy'` e não há override explícito
no `runConfig` — um override manual do usuário (escolha de modelo pra run inteira) sempre vence,
mesmo em economy, porque é uma decisão explícita e não deve ser silenciosamente sobrescrita.

Modelos econômicos por provedor (`backend/lib/config.js`, configuráveis via env):
- **Claude**: `claude-haiku-4-5-20251001` (vs. `claude-sonnet-4-20250514` default) — família Haiku é
  ordens de magnitude mais barata que Sonnet pra revisão/crítica de texto já estruturado.
- **OpenAI**: `gpt-4.1-mini` (vs. `gpt-4.1` default).
- **Gemini**: sem tier mais barato conhecido além do `gemini-3.6-flash` já usado como default (a
  família "lite" já é redirecionada pro flash em `resolveGeminiModel` por estar deprecada) — o env
  `GEMINI_MODEL_ECONOMY` fica disponível pra quando existir, mas hoje cai no mesmo modelo (sem
  mudança de comportamento).
- **Ollama**: `qwen2.5-coder:3b` (vs. `qwen2.5-coder:7b` default). Sem custo por token — é local —
  mas Ollama é o **provedor default** da forja (`FORJA_LLM_PROVIDER=ollama`), então deixá-lo de
  fora faria a feature não valer pra maioria das runs reais. Aqui a "economia" é tempo real de
  CPU/RAM por chamada, não dinheiro.
- **Cursor**: sem tier — `cursorModel: 'auto'` já delega a escolha ao próprio CLI.

O log de `thinkAsSenior` passa a incluir o modelo usado (`Revisão sênior concluída via
${provider} (${model})`), então fica visível em tempo real no terminal da forja qual modelo cada
revisão usou — sem precisar de nenhuma mudança de UI.

## Consequências

- Nenhuma mudança de comportamento pra quem não configurar as novas envs — os defaults de economia
  já vêm ativos (Haiku/mini), mas continuam substituíveis via `ANTHROPIC_MODEL_ECONOMY` /
  `OPENAI_MODEL_ECONOMY` / `GEMINI_MODEL_ECONOMY`.
- `architect`/`coder`/`debugger`/`healer`/`userFix` e a chamada principal de `human` continuam no
  modelo padrão sem exceção — a economia nunca compete com a qualidade do código gerado.
- Se no futuro surgir um tier mais barato real de Gemini, só trocar o default de
  `geminiModelEconomy` em `config.js` — o mecanismo de seleção já está pronto.
