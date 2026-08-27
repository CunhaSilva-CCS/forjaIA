# ForjaIA

![CI](https://github.com/CunhaSilva-CCS/forjaIA/actions/workflows/ci.yml/badge.svg)

Forja local self-hosted de software: pipeline multiagente (Arquiteto → aprovação → Codificador → QA/Segurança/Curador → sandbox Docker → deploy) com execuções persistentes, autenticação e isolamento de workspace.

## Requisitos

- Node.js 20+
- Docker Desktop / Docker Engine (obrigatório quando `FORJA_REQUIRE_DOCKER=true`)
- Chave da API Gemini **ou** [Ollama](https://ollama.com) local com um modelo de código

## Início rápido

```bash
cp .env.example .env
# defina FORJA_API_TOKEN e GEMINI_API_KEY (ou use Ollama)

npm install
npm install --prefix backend
npm install --prefix frontend

npm run dev
```

- Interface: http://localhost:5173  
- API: http://127.0.0.1:3001  

Na primeira abertura, cole o `FORJA_API_TOKEN` do `.env` (ou de `backend/data/.api-token` se você não definiu o token em desenvolvimento).

## Execução local “de produção”

Um único processo (API + UI estática), Docker obrigatório, mocks off, bind em loopback.

```bash
# 1) Ajuste .env (token, FORJA_REQUIRE_DOCKER=true, LLM)
cp .env.example .env

# 2) Pré-voo + build + start
npm run start:local-prod
```

- App: http://127.0.0.1:3001  
- Cole o `FORJA_API_TOKEN` do `.env` na UI  

Só validar o ambiente:

```bash
npm run build
npm run check:local-prod
```

Desenvolvimento (Vite :5173 + API :3001):

```bash
npm run dev:stable
```

## Arquitetura

| Peça | Função |
|--------|------|
| Plano de controle | Express + WebSocket em `127.0.0.1`, auth Bearer |
| SQLite | Projetos, execuções, eventos, versões de arquivos, preferências |
| Provedor LLM | Gemini ou Ollama com retries; mocks só se `FORJA_ALLOW_MOCKS=true` |
| Raiz do workspace | Navegação/deploy restritos a `FORJA_WORKSPACE_ROOT` |
| Sandbox | Container Docker com limites de memória/CPU |

## Destaques da API

- `GET /api/health` — prontidão pública
- `Authorization: Bearer <FORJA_API_TOKEN>` em todas as outras rotas `/api/*`
- `POST /api/agent/run` · `POST /api/agent/approve` · `POST /api/agent/cancel`
- `GET /api/runs` · `GET /api/runs/:id` · `GET /api/runs/:id/export`
- `GET/POST /api/projects` · `GET/POST /api/preferences`

## Testes

```bash
npm test              # backend (node --test) + frontend (vitest)
npm run test:backend
npm run test:frontend
```

## Observações

- Engenharia do caos: com sandbox Docker disponível, os faults são **reais** contra o container (`tc netem` para latência/perda de pacotes via container-sidecar, `container.update()` para reduzir a cota de CPU) — não simulação. Sem Docker (ou se a operação real falhar), cai automaticamente para injeção de falhas no cliente (documentado no campo `chaosMode` das métricas). Em nenhum dos dois casos há comprometimento da rede do host.
- Segredos (Gemini) ficam só no servidor — nunca são enviados pela interface.

## Decisões arquiteturais

Ver [docs/adr/](docs/adr/) para o raciocínio por trás de mudanças estruturais não óbvias no diff.
