# ADR-034 — QA parava de confiar em código correto por causa de um acoplamento com os mocks

**Status:** Aceito

## Contexto

Achado numa sessão de dogfooding ao vivo (rodei o ForjaIA contra ele mesmo, numa forja real com
Ollama local, acompanhando cada etapa na tela): depois de corrigir um `tsconfig.json` ausente, um
import quebrado e uma rota mal montada — todos via "Fale com o Corretor" — o app final respondia
corretamente (200 com lista vazia, 201 com o recurso criado, 400 exatamente onde devia), mas o QA
continuava reprovando 100% dos testes.

Investigando `agent/qa.js`: `detectSuite(files)` escolhe entre só três suítes fixas — `rag`,
`auth`, ou `crud` como catch-all pra qualquer outra coisa. A suíte `crud` (e em menor grau a
`rag`) tinha asserções que exigiam um formato EXATO de envelope: `data.success === true &&
Array.isArray(data.tasks)`, `data.success === true && data.task.id`, etc. Rastreando esse formato
até a origem: é EXATAMENTE o formato dos `MOCK_CODES` em `agent/coder.js` — código-fonte hardcoded
usado como fallback offline só quando `config.allowMocks` está ligado. A constituição
(`lib/seniorEngineer.js`) só instrui o contrato ABSTRATO `{success, data|error}` — nunca os nomes
de campo específicos `tasks`/`task`/`matches` que só existem nos mocks.

Resultado: `runCrudTests`/`runRagTests` rodam incondicionalmente (sem checar `allowMocks`), então
qualquer app gerado por um LLM real — que só viu o contrato abstrato, nunca o nome de campo exato
— reprova sistematicamente, não importa quão correto esteja. `runAuthTests`, escrita com mais
cuidado, já tinha o antídoto: helpers como `pickToken`/`pickUser` que aceitam vários formatos
razoáveis (`token`, `accessToken`, `data.token`) em vez de um nome fixo — só que ninguém tinha
aplicado o mesmo padrão nas outras duas suítes.

## Decisão

Apliquei o mesmo padrão de tolerância que `runAuthTests` já validava, agora também em
`runCrudTests` e `runRagTests`:

- **Listar**: aceita array na raiz da resposta OU dentro de `tasks`/`data`/`items`/`results`/
  `todos` — não só `tasks`.
- **Criar**: aceita o recurso criado na raiz (com `id`) OU dentro de `task`/`data`/`item`.
- **Falha de validação**: só exige status 4xx (o sinal que realmente importa) — parou de exigir
  também um campo `success:false` específico no corpo.
- **Atualizar**: mesma busca flexível pra achar o campo alterado (`completed`) em qualquer
  envelope razoável.
- **Deletar**: aceita `204 No Content` (convenção REST válida e comum, que a versão anterior
  quebraria tentando fazer `.json()` num corpo vazio) além de `200`.
- **RAG — health/ingest/query**: mesmo raciocínio — aceita `ok`/`status`/`success` pro health
  check, e array de resultado em `matches`/`results`/`data`.

Continua validando o que realmente importa (status HTTP correto, o recurso criado tem id, a
atualização de fato aplicou) — só não trava mais numa única convenção de nome de campo entre
várias igualmente razoáveis.

## Verificação ao vivo

Rodei `runCrudTests` de novo contra o MESMO container Docker/app real desta sessão (não um
fixture) — o app gerado pelo Ollama que reprovava 0/5 antes da correção. Depois da correção:
**5/5 passou**, sem tocar em nada do código do app em si — só a suíte de QA parou de exigir um
contrato que nunca tinha sido comunicado.

## Consequências

- Backend: 340/340 (6 testes novos em `qaCrudTolerance.test.js`, incluindo um confirmando que o
  formato EXATO dos `MOCK_CODES` continua passando sem regressão, e dois confirmando que a
  tolerância não virou "sempre passa" — uma lista genuinamente ausente ou um HTTP 500 ainda
  reprovam de verdade).
- Não resolvi o problema pela raiz mais estrutural (as suítes continuam sendo só 3 templates
  fixos — `detectSuite` continua incapaz de testar um app que não seja RAG/Auth/CRUD-de-tarefas de
  forma significativa) — resolvi a fatia que causava falso-negativo em código correto, que era o
  problema imediato e mais grave. Uma suíte de QA gerada dinamicamente a partir do plano do
  Arquiteto (testando os endpoints que o próprio app realmente expõe) é uma evolução natural, mas
  é uma mudança maior, fora do escopo deste ADR.
- `MOCK_CODES` (`agent/coder.js`) não precisou mudar — o formato que ele já usa é um dos formatos
  aceitos pela busca tolerante, não o único.
