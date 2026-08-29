# Architecture Decision Records

Registro das decisões arquiteturais relevantes do ForjaIA — o quê foi decidido, por quê, e o que isso custa. Não é changelog; é o raciocínio por trás de mudanças que não são óbvias só lendo o diff.

## Checklist pra ADR que integra ferramenta externa nova

Todo ADR que adiciona integração com uma ferramenta externa nova (CLI, servidor, driver — o padrão
que Playwright/ADR-022 e Appium/ADR-029 já seguiam informalmente, formalizado no ADR-030) precisa de
uma seção **"Verificação ao vivo"** descrevendo o que foi testado contra a ferramenta REAL, não só
contra mock/fake server. Testes com mock continuam necessários (determinismo, velocidade), mas não
substituem isso — o ADR-029 achou 2 bugs reais (timeout curto demais, sinal errado pra "elemento
tocável") que nenhum mock pegaria, só apareceram testando contra Appium/XCUITest de verdade.

## Checklist pra novo campo em `currentTask`/`savedConfig`

Se um estágio grava `orchestrator.currentTask.X` e algum código lê esse campo direto de lá (não via
`orchestrator.savedConfig?.X`), esse campo precisa sobreviver a um restart do processo no meio da
run — ver ADR-030 pra regra completa e `backend/test/restartSafety.test.js` pro molde de teste que
comprova isso.

- [ADR-001 — Extrair estágios do orchestrator em módulos separados](001-orchestrator-stage-modules.md)
- [ADR-002 — Decompor App.tsx e useForjaApp.ts](002-frontend-decomposition.md)
- [ADR-003 — Chaos engineering real via API do Docker, com fallback simulado](003-real-chaos-engineering.md)
- [ADR-004 — TypeScript strict mode e eliminação de `any`](004-typescript-strict-mode.md)
- [ADR-005 — Endurecimento de segurança pontual (rate limit, tokens, purge)](005-security-hardening.md)
- [ADR-006 — Watchdog exige falhas seguidas antes de reiniciar](006-watchdog-unhealthy-threshold.md)
- [ADR-007 — Cursor Agent como provedor de LLM opt-in, isolado em cwd descartável](007-cursor-agent-provider.md)
- [ADR-008 — Prompt caching para Claude; sem mudança para os demais provedores](008-prompt-caching-claude.md)
- [ADR-009 — CI no Node 22 (compatível com better-sqlite3 ≥13) + isolamento de DB por arquivo de teste](009-ci-test-isolation-sigsegv.md)
- [ADR-010 — Modelo econômico na camada de revisão sênior, entregável intocado](010-model-tier-economy.md)
- [ADR-011 — Diversidade de provedor na revisão sênior + scanner determinístico de segredos](011-review-diversity-and-secret-scan.md)
- [ADR-012 — Instrumentação de confiabilidade medida por run](012-reliability-instrumentation.md)
- [ADR-013 — Card de confiabilidade na UI + escalada de provedor na última cura](013-reliability-card-and-healer-escalation.md)
- [ADR-014 — Suporte a projetos mobile Expo/React Native (QA nativo + deploy no Simulador)](014-mobile-expo-support.md)
- [ADR-015 — Fallback prioriza outro provedor cloud quando a falha é de billing](015-billing-aware-fallback.md)
- [ADR-016 — userFix.js manda só os arquivos relevantes, não o codebase inteiro](016-userfix-selective-files.md)
- [ADR-017 — Uso equilibrado entre provedores via dado real (não saldo de crédito)](017-usage-credit-ui.md)
- [ADR-018 — Deploy mobile também para macOS (Catalyst) e Windows (GitHub Actions)](018-mac-and-windows-deploy.md)
- [ADR-019 — Pente fino: 2 críticos + 4 altos corrigidos numa auditoria dedicada](019-fine-tooth-comb-review.md)
- [ADR-020 — Restante do pente fino: os ~13 achados médios/baixos do ADR-019](020-remaining-findings-cleanup.md)
- [ADR-021 — Auditoria independente (Semgrep + npm audit), separada do pipeline](021-independent-audit.md)
- [ADR-022 — Teste humano com navegador real (Playwright), fechando o gap do ADR-014](022-real-browser-human-test.md)
- [ADR-023 — Aba "Auditoria" na UI, fechando o loop do ADR-021](023-audit-tab-ui.md)
- [ADR-024 — Teto de orçamento estimado por run, reusando o gate de aprovação existente](024-run-budget-cap.md)
- [ADR-025 — Papel "viewer" + fecha o RBAC não-enforced em run/cancel/relato](025-rbac-viewer-role.md)
- [ADR-026 — Corretor escala de provedor + consistência de sistema de módulos na constituição](026-userfix-escalation-and-module-consistency.md)
- [ADR-027 — Fecha as lacunas de cobertura de teste no frontend](027-frontend-test-coverage-gaps.md)
- [ADR-028 — UI de gestão de equipe (criar e desativar membros)](028-team-management-ui.md)
- [ADR-029 — Teste humano real no Simulador via Appium/XCUITest](029-mobile-human-test-appium.md)
- [ADR-030 — Segurança de restart sistemática + esquema canônico de estado de run](030-restart-safety-and-state-schema.md)
- [ADR-031 — Deploy e teste humano no emulador Android](031-android-emulator-support.md)
- [ADR-032 — Backup do SQLite + procedimento de restore documentado](032-database-backup.md)
- [ADR-033 — Endpoint de saúde operacional agregada](033-ops-health-endpoint.md)
- [ADR-034 — QA parava de confiar em código correto por causa de um acoplamento com os mocks](034-qa-suite-mock-coupling.md)
- [ADR-035 — Dogfooding automático e agendado (script + crontab do macOS)](035-scheduled-dogfooding.md)
