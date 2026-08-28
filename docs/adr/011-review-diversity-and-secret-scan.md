# ADR-011 — Diversidade de provedor na revisão sênior + scanner determinístico de segredos

**Status:** Aceito

## Contexto

Levantamento crítico do pipeline (pedido explícito do usuário) identificou dois pontos onde a
malha de segurança do ForjaIA é redundância probabilística, não verificação de verdade:

1. **Erro correlacionado entre gerador e revisor.** `thinkAsSenior` (usada por
   `security`/`qa`/`devops`/`reporter`/`human`, ver ADR-010) roda no mesmo provedor de LLM que
   gerou o código, salvo o usuário escolher outro manualmente. Isso significa que o "revisor" tem
   exatamente os mesmos pontos cegos e vieses sistemáticos de quem escreveu o código — não é uma
   segunda opinião independente, é a mesma rede reexaminando o próprio trabalho.
2. **Gate de segurança já é determinístico, mas os detectores são estreitos.** `agent/security.js`
   já bloqueia aprovação com base em `allIssues.length` — o veredito (`"seguro"`) do LLM revisor
   NUNCA sobrescreve esse cálculo, o que é correto. O problema é a cobertura do detector de
   segredos: o regex original só casa `(const|let|var) (JWT_SECRET|SECRET|API_KEY|PASSWORD) =
   "..."` — nome de variável exato, só sintaxe de declaração JS. Um `stripeApiKey` em camelCase,
   um `{ apiKey: "..." }` em objeto/JSON, ou um `.env` commitado com valor real passam batido pelo
   regex original, e um revisor LLM pode não pegar por não reconhecer o formato do segredo.

## Decisão

**1. `resolveReviewProvider(runConfig)`** (`backend/lib/llm.js`) — escolhe deliberadamente um
provedor diferente do primário da run pra `thinkAsSenior`, priorizando `gemini → claude → openai →
ollama` (a primeira alternativa configurada que não seja o provedor primário). Cursor nunca entra
nessa lista (mantém o princípio do ADR-007: só roda quando escolhido explicitamente). Sem
alternativa cloud configurada, cai pro mesmo provedor da run — degrada pro comportamento anterior,
nunca quebra. `thinkAsSenior` passa a montar seu `runConfig` com esse provedor forçado antes de
chamar `generateJson`.

**2. `scanForHardcodedSecrets(files)`** (`backend/lib/secretScan.js`, novo módulo) — dois
detectores adicionais, plugados na mesma lista `allIssues` que já bloqueia aprovação em
`agent/security.js`:
   - **Formato de token conhecido** (prefixo real: `sk-ant-...`, `AKIA...`, `AIza...`, `ghp_...`,
     `xox?-...`, `sk_live_...`, bloco `-----BEGIN...PRIVATE KEY-----`) — pega o segredo pelo
     FORMATO, funciona em qualquer arquivo/sintaxe, não só declaração JS.
   - **Atribuição suspeita mais ampla** — mesmo espírito do regex original, mas cobre variações de
     nome (camelCase, `db_password`, `stripeSecret`) e mais sintaxes (objeto/JSON `chave: "valor"`,
     linha estilo `.env` `CHAVE=valor` com valor real, excluindo arquivos `.example`/`.sample`).

Nenhuma mudança na lógica de gate em si — ela já era determinística. A mudança é ampliar o que os
detectores determinísticos enxergam, pra depender menos do LLM revisor reconhecer o padrão.

## Consequências

- Runs com só um provedor configurado (ex.: só Ollama local) continuam funcionando exatamente como
  antes — a diversidade de provedor é um bônus quando disponível, não um requisito.
- Revisão sênior agora pode custar uma chamada a um provedor cloud mesmo em runs que usam Ollama
  como primário, se houver key cloud configurada — trade-off aceito: o objetivo aqui é reduzir
  erro correlacionado, não economizar (isso já é tratado pelo tier econômico do ADR-010,
  combinável com este ADR sem conflito).
- `secretScan.js` pode gerar falso positivo em casos legítimos (ex.: uma string de 6+ caracteres
  que contenha a palavra "token" mas não seja um segredo real) — aceito como trade-off: nesta
  camada, falso positivo custa uma revisão extra; falso negativo custa um segredo vazado.

**Atualização (ver ADR-014)**: validar o pipeline contra um projeto mobile real (secPass) achou
falsos positivos concretos demais pra aceitar como trade-off — tanto o regex original de segredo
em `security.js` quanto o `secretScan.js` novo batiam em senha literal de fixture de teste
(`__tests__/*.test.js`) e numa constante cujo NOME continha "secret" mas o VALOR era uma frase de
erro. Corrigido: os dois detectores por nome ignoram arquivo de teste; o valor capturado precisa
não conter espaço (segredo de verdade não é frase); o regex de objeto-literal ganhou lookbehind
pra não casar ternário/member access (`item.password : "..."`) como se fosse `chave: valor`. O
scanner por FORMATO de token (`sk-ant-...`, `AKIA...`, etc.) continua valendo em qualquer arquivo,
inclusive de teste — um token real vazado num teste ainda é um vazamento real.
