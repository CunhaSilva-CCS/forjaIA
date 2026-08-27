# ADR-007 — Cursor Agent como provedor de LLM opt-in, isolado em cwd descartável

**Status:** Aceito

## Contexto

O ForjaIA já suporta 4 provedores de LLM intercambiáveis por run (Gemini, Claude, OpenAI, Ollama), todos acessados por uma mesma interface (`generateJson` em `backend/lib/llm.js`) que cada etapa do pipeline chama sem saber qual provedor está por trás. Adicionar o `cursor-agent` (CLI headless do Cursor) como quinto provedor levanta um problema que os outros quatro não têm: os quatro existentes são chamadas HTTP puras (fetch) contra uma API de completion — pedem texto, recebem texto. O `cursor-agent`, mesmo em modo não-interativo (`--print`), é descrito no próprio `--help` como tendo "access to all tools, including write and shell" no diretório onde roda.

## Decisão

Cursor entra como **mais um provedor no dropdown existente** (`llmProvider: 'cursor'`), não como um modo de execução onde ele edita arquivos diretamente no projeto sendo forjado. Cada chamada (`callCursorAgent` em `backend/lib/llm.js`) roda `cursor-agent -p <prompt> --output-format json --trust` num diretório temporário descartável (`fs.mkdtempSync`), nunca no repo do ForjaIA nem no `targetPath` real do projeto — isso neutraliza qualquer arquivo/comando que ele decida executar por conta própria, e o ForjaIA só consome o texto de `.result` como resposta do modelo, exatamente como já faz com os outros 4 provedores. O diretório é removido logo depois (best-effort).

A chamada usa `child_process.spawn` (nunca `execSync`) — o [ADR-006](006-watchdog-unhealthy-threshold.md) já documentou o custo de bloquear o event loop com uma chamada síncrona longa; uma geração de LLM real pode levar dezenas de segundos.

Cursor **não** entra em `fallbackProviders()`. Diferente do Ollama (grátis/local), consome o plano pago da conta Cursor do usuário — só deve rodar quando explicitamente selecionado, nunca como substituto silencioso de outro provedor que falhou.

Autenticação segue dois caminhos: `CURSOR_API_KEY` no `.env` (portável, sem depender de sessão local) ou a sessão já autenticada via `cursor-agent login` na máquina onde o backend roda (usada quando a variável não está setada).

## Consequências

- Nenhuma mudança no modelo de segurança existente do pipeline: continua verdade que nada é escrito no `targetPath` real antes da etapa de deploy, independentemente do provedor de LLM escolhido.
- O binário precisa estar no PATH do processo backend — como isso nem sempre é garantido (o instalador do CLI escreve em `~/.local/bin`, que pode não estar no PATH herdado por um serviço iniciado fora de um shell interativo), o spawn prefixa `~/.local/bin` explicitamente ao `PATH` herdado.
- Cursor não tem uma etapa de "verificação de chave" obrigatória em produção (mesmo tratamento do Ollama): é um provedor local/opcional, não uma dependência exigida para o servidor subir.
