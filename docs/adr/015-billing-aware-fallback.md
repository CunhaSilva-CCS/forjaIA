# ADR-015 — Fallback prioriza outro provedor cloud quando a falha é de billing

**Status:** Aceito

## Contexto

Validando o secPass ao vivo, toda chamada com `llmProvider: 'claude'` como primário caía numa
demora enorme: a chave da Anthropic está sem crédito ("Your credit balance is too low..."), o que
falha rápido — mas `fallbackProviders` já tinha uma regra fixa de tentar **Ollama local primeiro**
depois de qualquer falha do primário, com o raciocínio "provedores pagos costumam falhar juntos".
Isso é verdade pra uma falha de INFRA (rede fora, rate limit compartilhado), mas é falso pra uma
falha de BILLING — sem crédito na Anthropic não tem nenhuma relação com o Gemini estar disponível
ou não. O resultado prático: minutos processando um payload grande no Ollama local (lento numa
CPU) quando o Gemini (rápido, já provado funcionando a sessão inteira) estava disponível o tempo
todo, só não era tentado até DEPOIS do Ollama.

## Decisão

`isBillingError(err)` — subconjunto mais específico de `isRecoverableLlmError`, reconhece só
mensagens de crédito/billing esgotado (não confunde com rate limit genérico, timeout, etc, que
continuam na categoria "pode ser infra compartilhada").

`fallbackProviders(primary, { billingIssue })` — quando `billingIssue` é verdadeiro, tenta outros
provedores CLOUD configurados (Gemini, OpenAI, Claude) antes do Ollama; caso contrário, mantém a
ordem antiga (Ollama primeiro). `generateJson` só decide qual cadeia usar DEPOIS de ver o erro real
do provedor primário (antes computava a cadeia inteira de antemão, sem saber ainda o motivo).

## Consequências

- Falha de billing num provedor específico não paga mais o custo de esperar o Ollama local antes de
  tentar uma alternativa cloud que pode estar perfeitamente disponível.
- Falha genérica (rede, rate limit, timeout) continua indo pro Ollama primeiro — sem mudança de
  comportamento pra esse caso, que é o mais comum.
- Não resolve o caso em que o provedor de fallback retorna uma resposta tecnicamente válida mas
  semanticamente inadequada (ex.: JSON válido sem `files`) — isso ainda encerra a cadeia de
  fallback como "sucesso" do ponto de vista do `generateJson`; fica como lacuna conhecida, não
  coberta por este ADR.
