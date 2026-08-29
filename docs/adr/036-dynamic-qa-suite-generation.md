# ADR-036 — QA gera a suíte de teste dinamicamente a partir do código real, não só 3 templates fixos

**Status:** Aceito

## Contexto

O próprio ADR-034 já apontava essa lacuna: `agent/qa.js` só sabia rodar 3 suítes fixas
(`crud`/`auth`/`rag`, escolhidas por `detectSuite` sniffando palavras-chave nos arquivos). Qualquer
app que não se encaixasse bem num desses três moldes recebia uma bateria de testes genérica que não
refletia os endpoints reais que o Arquiteto/Codificador realmente construíram — cobertura de "3
padrões fixos" em vez de cobertura do que o app de fato expõe.

## Decisão

Antes de cair nas 3 suítes fixas, `qa.execute` agora tenta gerar um plano de teste executável via
LLM (`generateTestPlan`, novo contrato JSON em `agent/qa.js`), dando ao modelo o conteúdo real dos
arquivos gerados e pedindo uma lista de casos HTTP (`method`, `path`, `body`, `expectedStatus`,
`expect`, `captureAs`) cobrindo os endpoints que ele realmente vê no código — nunca inventando rota.

Um executor genérico novo, `lib/testPlanRunner.js` (`runGeneratedTests`), roda esses casos contra o
sandbox real: encadeia valores capturados entre casos (ex.: captura o id criado, reusa em
`/api/tasks/{id}` no caso seguinte; captura um token de login, reusa como `Authorization: Bearer` em
qualquer caso `auth:true`), com o mesmo tipo de checagem tolerante a formato de envelope que o
ADR-034 já tinha provado necessária (`expect:"list"`/`"object-id"` aceitam a lista/objeto em
qualquer chave de envelope razoável, não uma nomeada especificamente) — a instrução pro LLM já
inclui essa regra explicitamente, pra não reintroduzir o mesmo bug por um caminho novo.

As 3 suítes fixas (`runCrudTests`/`runAuthTests`/`runRagTests`, com o `detectSuite` de sempre)
continuam existindo, intocadas, como **fallback determinístico**: se a geração do plano falhar (LLM
indisponível) ou vier vazia/com menos de 2 casos válidos, `qa.execute` cai pra elas automaticamente,
com log explícito de qual caminho foi tomado.

## Verificação ao vivo

Rodei `qa.execute` direto contra um sandbox Docker real e o mesmo app Express/TypeScript real desta
sessão (o CRUD de tarefas já corrigido no ADR-034), com o provedor de LLM real configurado
(Gemini). Durante a verificação, o Gemini esgotou a cota (429) e o fallback automático pro Ollama
local (`lib/llm.js`, ADR-015/017) funcionou corretamente — a geração do plano dinâmico se completou
via Ollama, produzindo 10 casos de teste reais a partir do código, confirmando que o caminho
dinâmico funciona ponta a ponta contra infraestrutura real (LLM real + fallback real + Docker real).

Os 10 testes gerados reprovaram nessa rodada especificamente — não por causa da geração dinâmica em
si, mas porque o sandbox se declarou "pronto" antes da aplicação responder de verdade (investigação
separada, não coberta por este ADR).

## Consequências

- Backend: +16 testes novos (12 em `testPlanRunner.test.js` cobrindo o executor genérico
  isoladamente com servidor HTTP real; 4 em `qaDynamicSuite.test.js` cobrindo a decisão
  dinâmico-vs-fallback em `qa.execute`, incluindo o caso de plano insuficiente/inválido).
- Custo real recorrente: mais uma chamada de LLM por execução de QA (a geração do plano), além da
  chamada de revisão sênior que já existia. Acion aceito explicitamente pelo usuário como troca por
  cobertura mais fiel ao código real.
- `MOCK_CODES` (`agent/coder.js`) e as 3 suítes fixas não mudaram — continuam sendo o piso de
  segurança determinístico quando o LLM não está disponível.
