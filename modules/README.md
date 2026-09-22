# Modules

Domain-driven module layer. Each module owns a bounded context and exposes a
thin service API consumed by server components, route handlers, and server
actions. Modules never import UI; they depend on `lib/` (Prisma, auth, env).

```
modules/
├── products/     Catalog management
├── creators/     Creator roster & relationships
├── campaigns/    Campaign orchestration
├── messaging/    Conversations & notifications
├── sales/        Orders & revenue
├── analytics/    Metrics & reporting  (interface only — PR006)
└── integrations/ External providers   (interfaces only — TikTok/OpenAI)
```

## Conventions

- `*.service.ts` — data access and business logic (server-only).
- `*.types.ts` — module-local DTOs and input schemas (Zod).
- Integration modules expose **interfaces only** in PR000. No network calls,
  scraping, TikTok API, OpenAI, or analytics pipelines are implemented yet.
