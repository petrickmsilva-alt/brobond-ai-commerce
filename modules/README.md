# Modules

Domain-driven module layer. Each module owns a bounded context and exposes a
thin service API consumed by server components, route handlers, and server
actions. Modules never import UI; they depend on `lib/` (Prisma, auth, env).

```
modules/
├── commerce/
│   └── products/     Product Intelligence Core (PR001)
│       ├── services/       business logic (server-only)
│       ├── repositories/   tenant-scoped Prisma data access (server-only)
│       ├── dto/            serializable shapes for the UI layer
│       ├── pricing/        pure margin math (cents + basis points)
│       └── validators/     Zod schemas + slug helpers (pure)
├── trends/       Trend Hunter AI (PR002 — mock source, no external APIs)
│   ├── hunter/            collector (mock) · scorer (pure) · scheduler (manual job)
│   ├── repositories/      tenant-scoped Prisma data access (server-only)
│   ├── dto/               CreateTrendDTO + serializable RSC shapes
│   ├── validators/        Zod schemas + keyword slug helpers (pure)
│   └── interfaces/        TrendSignal · TrendCollector · TREND_CATEGORIES
├── creators/     Creator roster & relationships
├── campaigns/    Campaign orchestration
├── messaging/    Conversations & notifications
├── sales/        Orders & revenue
├── analytics/    Metrics & reporting  (interface only — PR007)
└── integrations/ External providers   (interfaces only — TikTok/OpenAI)
```

## Conventions

From PR001 onward, feature modules follow the `commerce/products` layout:
`services/ · repositories/ · dto/ · pricing (or domain logic) · validators/`.
Repositories take `organizationId` as their **first argument** — no query runs
without a tenant scope.

- `*.service.ts` — data access and business logic (server-only).
- `*.types.ts` — module-local DTOs and input schemas (Zod).
- Integration modules expose **interfaces only** in PR000. No network calls,
  scraping, TikTok API, OpenAI, or analytics pipelines are implemented yet —
  including the Trend Hunter, which runs on a **mock collector** (PR002): a
  real source implements `TrendCollector` (`modules/trends/interfaces`) and
  is returned by `getTrendCollector()` with zero caller changes.
