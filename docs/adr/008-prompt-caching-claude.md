# ADR-008 — Prompt caching para Claude; sem mudança para os demais provedores

**Status:** Aceito

## Contexto

A "constituição" compartilhada (`seniorEngineer.js`) — identidade, mentalidade, checklist de
produção, regras de estilo — é injetada em **todo** system prompt do pipeline: Arquiteto,
Codificador, QA, Segurança, Depurador, cada tentativa de Cura, DevOps, Humano, checklist de
produção. Esse bloco tem ~1.200 tokens e é **idêntico** em praticamente todas as chamadas de
uma run (varia só se o usuário mudar as regras de estilo no meio da run, o que é raro). Numa
run típica com 10-20 chamadas de LLM, isso sozinho já passa de 15-20 mil tokens de puro texto
repetido, sem contar o conteúdo específico de cada etapa.

## Decisão

**Claude**: implementado prompt caching real via `cache_control: {type: "ephemeral"}` da API da
Anthropic. Pré-requisito: o trecho cacheado precisa ser um *prefixo* estável do prompt — por
isso `composeSystemPrompt()` foi reordenado pra colocar o bloco fixo (constituição + regras)
**primeiro**, com o título do papel (que varia por etapa) e a missão da etapa vindo depois.
`callClaude()` reconstrói esse prefixo localmente (mesma função que o gerou) e, se o `system`
recebido começa com ele, separa em dois blocos: o fixo marcado com `cache_control`, o resto
sem. Chamadas fora desse formato (system prompt customizado) caem para string simples, sem
quebrar.

**Gemini**: modelos 2.x+ (como o `gemini-3.6-flash` já configurado por padrão) fazem cache
implícito automaticamente — sem precisar de nenhuma mudança de código, desde que o prefixo do
prompt seja estável, o que já é verdade aqui. Cache *explícito* (criar um recurso `CachedContent`
via API separada) daria um desconto mais garantido, mas exige gerenciar o ciclo de vida desse
recurso (criar, referenciar, expirar) — complexidade desproporcional ao ganho sobre o que o
cache implícito já cobre sozinho. Não implementado.

**OpenAI**: cache automático de prompt já é padrão da API (prompts >1024 tokens, sem nenhuma
configuração) — nada a fazer.

**Ollama**: modelo local, sem custo por token e sem uma API de cache de prompt equivalente pra
controlar explicitamente — não se aplica.

**Cursor** (CLI headless): não expõe um controle de cache de prompt na interface atual — não se
aplica.

## Consequências

- `composeSystemPrompt()` muda de ordem (bloco fixo primeiro) — comportamento observável apenas
  se algo dependesse da ordem exata do texto do prompt, o que não é o caso hoje (nenhum teste
  fazia essa suposição).
- `stableConstitutionBlock()` fica exportado de `seniorEngineer.js` especificamente pra permitir
  essa reconstrução determinística em `llm.js`, sem duplicar a lógica de regras de estilo.
- `tokens.prompt` do Claude agora soma `input_tokens + cache_read_input_tokens +
  cache_creation_input_tokens` (a API não inclui o trecho cacheado em `input_tokens` sozinho) —
  sem isso, o dashboard de tokens subestimaria o total processado, mesmo que o *custo* real
  tenha caído.
