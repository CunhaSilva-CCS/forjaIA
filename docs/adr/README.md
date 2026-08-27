# Architecture Decision Records

Registro das decisões arquiteturais relevantes do ForjaIA — o quê foi decidido, por quê, e o que isso custa. Não é changelog; é o raciocínio por trás de mudanças que não são óbvias só lendo o diff.

- [ADR-001 — Extrair estágios do orchestrator em módulos separados](001-orchestrator-stage-modules.md)
- [ADR-002 — Decompor App.tsx e useForjaApp.ts](002-frontend-decomposition.md)
- [ADR-003 — Chaos engineering real via API do Docker, com fallback simulado](003-real-chaos-engineering.md)
- [ADR-004 — TypeScript strict mode e eliminação de `any`](004-typescript-strict-mode.md)
- [ADR-005 — Endurecimento de segurança pontual (rate limit, tokens, purge)](005-security-hardening.md)
- [ADR-006 — Watchdog exige falhas seguidas antes de reiniciar](006-watchdog-unhealthy-threshold.md)
