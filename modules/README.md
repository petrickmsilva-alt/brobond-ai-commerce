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
├── trends/       Trend Hunter AI (PR002 · multi-source architecture in PR002.1)
│   ├── hunter/            collectors (one per TrendSource) · collector.factory ·
│   │                      scorer (pure) · scheduler (manual job, per-source)
│   ├── repositories/      tenant-scoped Prisma data access (server-only)
│   ├── dto/               CreateTrendDTO (+ source) + serializable RSC shapes
│   ├── validators/        Zod schemas (+ trendSourceSchema) + keyword slug helpers
│   └── interfaces/        TrendCandidate · TrendCollector · TREND_SOURCES ·
│                          TREND_CATEGORIES
├── connectors/   Connector Framework (PR005 — architecture only, no real API)
│   ├── core/          connector.interface · connector.factory · connector.validator ·
│   │                  connector.dto · connector.repository (server-only) ·
│   │                  connector.sync (server-only, manual job)
│   ├── mock/          MockConnector — the only IMPLEMENTED adapter (deterministic)
│   ├── tiktok/        TikTokConnector — placeholder ("Not implemented")
│   ├── instagram/     InstagramConnector — placeholder ("Not implemented")
│   └── shopee/        ShopeeConnector — placeholder ("Not implemented")
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
  including the Trend Hunter, which runs on a **mock collector** (PR002).
  Since PR002.1 it is **multi-source**: a real source implements
  `TrendCollector` (`modules/trends/interfaces`), lives in
  `modules/trends/hunter/collectors/` and is resolved by
  `getCollector(source)` (`collector.factory.ts`) with zero caller changes —
  never by instantiating a collector or switching on the source outside the
  factory. `MANUAL` has no collector: manual trends come from the dashboard
  form and are stamped `source: MANUAL` server-side.
- **Connectors (PR005)** follow the very same rule: a platform adapter
  implements `Connector` (`modules/connectors/core/connector.interface.ts`),
  lives in `modules/connectors/<platform>/` and is resolved by
  `getConnector(platform)` (`core/connector.factory.ts`) — never by
  instantiating an adapter or switching on the platform outside the factory.
  PR005 delivers the **architecture only**: `MockConnector` is implemented,
  TikTok/Instagram/Shopee are placeholders that throw
  `ConnectorNotImplementedError`. Zero network calls, zero SDKs, zero
  credentials. An adapter may only _describe_ content
  (`NormalizedContent`) — the import outcome (IMPORTED / DUPLICATE /
  FAILED) is decided by the sync service, never by the connector.
