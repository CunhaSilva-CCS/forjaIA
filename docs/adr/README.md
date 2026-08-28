# Architecture Decision Records

Registro das decisões arquiteturais relevantes do ForjaIA — o quê foi decidido, por quê, e o que isso custa. Não é changelog; é o raciocínio por trás de mudanças que não são óbvias só lendo o diff.

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
