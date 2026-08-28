# ADR-017 — Uso equilibrado entre provedores via dado real (não saldo de crédito)

**Status:** Aceito

## Contexto

Pedido: uma interface que consulte os modelos de IA pra saber o crédito disponível, e que o
ForjaIA seja inteligente o suficiente pra escolher qual modelo usar visando uso equilibrado de
créditos — substituindo o card de LLM/tokens atual.

Investigação antes de implementar: **nenhum dos três provedores configurados (Anthropic/Claude,
Google/Gemini, OpenAI) expõe uma API de saldo/crédito consultável só com a chave de API que o
ForjaIA já usa.** Isso só existe no painel web de cada um. A OpenAI tem uma API de uso/custo real,
mas exige uma chave de Admin de organização — diferente da chave de projeto normal já configurada.
Construir uma "consulta de crédito" nessas condições seria fingir um dado que não existe.

## Decisão

Em vez de saldo, o ForjaIA passa a medir e reagir a dois sinais 100% reais:

**1. Ledger de uso real** (`lib/llmUsage.js`, tabela `llm_usage`) — toda chamada de LLM
bem-sucedida grava provedor, modelo, tier e tokens com timestamp. `llmUsage.periods()` agrega em
três janelas (hoje, 7 dias, 30 dias) por provedor — dado medido, nunca estimado.

**2. Cooldown reativo por billing** (tabela `provider_cooldowns`) — quando `isBillingError` (ADR-
015) detecta que um provedor está sem crédito, `generateJson` marca esse provedor em cooldown por
1h (`FORJA_PROVIDER_COOLDOWN_MS`, configurável). Enquanto em cooldown:
- `resolveProvider` para de escolher esse provedor como default automático (só quando não há
  escolha EXPLÍCITA do usuário — um `runConfig.llmProvider` explícito nunca é sobrescrito
  silenciosamente).
- `fallbackProviders` joga esse provedor pro fim da fila de alternativas (ainda tentável como
  último recurso, só não prioritário).
- A UI mostra "sem crédito até HH:MM" com um botão "resetar" pra quando o usuário confirma
  manualmente que recarregou — sem isso, o cooldown só expira sozinho pelo tempo.

**3. Uso equilibrado real** — `pickBalancedProvider()` (usado por `resolveReviewProvider`, ADR-011,
e por `resolveProvider` quando o default está em cooldown) escolhe, entre os provedores cloud
configurados e disponíveis, o que gastou MENOS tokens hoje — soma diversidade de provedor (ADR-011)
com uso equilibrado de verdade, sem depender de saldo.

**UI** — `LlmTokensCard.tsx` foi reescrito no lugar (não um card novo): mantém o seletor de
provedor/modelo (ainda necessário pra escolha manual), ganha uma tabela de uso por provedor
(hoje/7 dias/30 dias) com destaque visual e botão de reset pro provedor em cooldown, e mantém a
barra de "esta run" — agora rotulada explicitamente pra não confundir com o histórico agregado.
Atualiza no mount e a cada `tokens-updated` do WebSocket (ao vivo, sem precisar recarregar).

## Consequências

- Não existe "porcentagem de crédito restante" em lugar nenhum da UI — seria inventar um número.
  O que existe é honesto: uso medido + reação a falha real.
- Cooldown de 1h é uma escolha arbitrária (crédito esgotado normalmente não se resolve sozinho em
  minutos, mas também não queremos ignorar o provedor pra sempre) — o botão de reset manual cobre
  o caso comum de "acabei de recarregar".
- `pickBalancedProvider` decide com base em tokens de HOJE, não em custo real em R$/US$ (tokens de
  provedores diferentes têm preços diferentes) — é um proxy, não uma otimização de custo exata.
