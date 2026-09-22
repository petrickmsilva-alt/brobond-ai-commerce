# PROJECT STATE — Brobond AI Commerce OS

> Living document tracking the architectural state of the platform.
> Updated per PR. Source of truth for "what exists" vs. "what is planned".

**Last updated:** 2026-09-22
**Current PR:** PR004 — Outreach AI & Sales Pipeline
**Status:** completed (awaiting review/merge)
**Branch:** `arena/01a0caa7-brobond-ai-commerce` (Arena session branch; requested spec branch: `feature/pr004-outreach-ai`)
**Next PR:** PR005 — Campaign Engine

> **Workflow (instituted in PR001):** no more direct merges to `main`.
> Feature branch → Pull Request → human audit → approval → merge → Render deploy.

---

## 1. Snapshot

| Aspect       | State                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Stage        | Second feature module shipped (Products + Trends) + PR002.1 datasource hotfix                                            |
| Architecture | **Multi-tenant, enforced** (`organizationId` NOT NULL on domain models) · **multi-source trends** (PR002.1)              |
| Modules      | `modules/commerce/products` — services / repositories / dto / pricing / validators                                       |
|              | `modules/trends` — hunter (collectors / collector factory / scorer / scheduler) / repositories / dto / …                 |
| Currency     | **BRL** (default across Product, Campaign, Sale) · money = integer cents · margin = basis points                         |
| Auth         | NextAuth v5 (Prisma adapter, JWT) + **Credentials provider (email/senha)**                                               |
| RBAC         | ADMIN > MANAGER > MEMBER — products: ADMIN cria/edita/exclui · MANAGER edita · MEMBER somente leitura                    |
| Database     | PostgreSQL via Prisma (pg driver adapter, Rust-free client)                                                              |
| Migrations   | `…_init_multitenant` · `…_require_organization` · `…_product_intelligence_core` · `…_trend_hunter_ai` · `…_trend_source` |
| Tests        | Vitest — 297 unit tests (RBAC, session, tenancy, passwords, pricing, slug, validators, filters, storage, trends)         |
| Deploy       | Render Blueprint (`render.yaml`) + GitHub Actions                                                                        |
| Build/CI     | ✅ green (ci → validate → generate → lint → typecheck → test → build → format)                                           |

---

## 2. Tech Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
Prisma ORM · PostgreSQL · NextAuth v5 · bcryptjs · Zod · React Hook Form ·
Lucide · Vitest · Docker · ESLint · Prettier · Render.

---

## 3. Multi-Tenancy (hardened in PR000.2)

`Organization` is the top-level tenant. The following models carry a
**required** `organizationId` foreign key (`onDelete: Cascade`):

| Model            | Column                  | Relation                |
| ---------------- | ----------------------- | ----------------------- |
| `User`           | `organizationId String` | `organization` required |
| `Product`        | `organizationId String` | `organization` required |
| `CreatorProfile` | `organizationId String` | `organization` required |
| `Campaign`       | `organizationId String` | `organization` required |

> **No domain record can exist without an Organization.** The database enforces
> it (`NOT NULL` + FK), not just the application layer.

`Sale` and `Message` inherit tenant scope transitively through their parent
relations (product/creator/campaign). `salesService` therefore scopes via a
relational filter. Promoting them to direct tenant FKs is tracked for a later PR.

### Tenant isolation contract

Server-side helpers (`lib/session.ts`, server-only):

- `getCurrentUser()` — current principal or `null` (never throws).
- `getCurrentOrganization()` — current `organizationId` or `null` (never throws).
- `requireUser()` — throws `AuthorizationError` 401 when unauthenticated.
- `requireOrganization()` — throws 401/403; returns a guaranteed `organizationId`.

Tenant primitives (`lib/tenant.ts`, pure/testable):

- `assertOrganizationId(id)` — 403 when the scope is missing/blank.
- `tenantWhere(id)` → `{ organizationId }`.
- `scopedWhere(id, where)` — merges the scope **last** so a caller filter can
  never widen or override the boundary.
- `assertSameTenant(record, id)` — returns `null` for a foreign record (no leak
  of another tenant's existence via globally-unique keys like `slug`/`handle`).

**Mandatory service pattern** — no domain service may query without a scope:

```ts
// route / server action
const organizationId = await requireOrganization();
const products = await productsService.list(organizationId);

// service (modules/products/products.service.ts)
list(organizationId: string) {
  return prisma.product.findMany({ where: tenantWhere(organizationId) });
}
// → where: { organizationId: currentOrganizationId }
```

All four domain services (`products`, `creators`, `campaigns`, `sales`) now take
`organizationId` as their first argument.

---

## 4. Auth (hardened in PR000.2)

- NextAuth v5 + `@auth/prisma-adapter`, JWT session strategy — **preserved**.
- **Credentials provider** (`email` + `password`) wired and functional.
- **No public sign-up.** `authorize()` only authenticates users that already
  exist and already have a `passwordHash`. Accounts are provisioned
  out-of-band (`prisma/seed.ts`, gated by `SEED_ADMIN_PASSWORD`).
- Passwords stored **only** as a bcrypt digest (cost 12) in `User.passwordHash`.
  Plaintext is never persisted, logged or returned.
- Failures are indistinguishable: the same generic error, plus
  `equalizeVerificationTiming()` on the "unknown account" branch to blunt
  user-enumeration via timing.
- `jwt` callback persists `role` + `organizationId`, and re-reads them from the
  database when a token predates this hardening or on explicit `update`.
- Sign-in runs through a server action (`app/login/actions.ts`); the client
  bundle never sees a secret.

### RBAC

Roles: `ADMIN` > `MANAGER` > `MEMBER`.

Pure logic — `lib/rbac.ts` (no NextAuth/Prisma runtime dependency):

- `hasRole(role, required)` · `isAdmin(role)` · `isManager(role)` ·
  `assertRole(role, required)` · `ROLE_RANK` · `ROLE_HIERARCHY`
- `AuthorizationError` carries `status: 401 | 403` for direct HTTP mapping.

Session guards — `lib/session.ts`:

- `requireRole(required)` — asserts role **and** tenant; returns a user with a
  non-nullable `organizationId`.
- `requireAdmin()` — `requireRole(ADMIN)`.
- `requireManager()` — `requireRole(MANAGER)` (ADMIN passes).

---

## 5. Data Model

| Model                             | Purpose                                             | Tenant-scoped     |
| --------------------------------- | --------------------------------------------------- | ----------------- |
| Organization                      | Tenant boundary                                     | — (is the tenant) |
| User                              | Team members + roles                                | ✅ required FK    |
| Product                           | Catalog (BRL, stock, cost, margin)                  | ✅ required FK    |
| ProductMedia                      | Product images/videos (PR001)                       | ✅ required FK    |
| ProductVariant                    | Sellable variations + stock (PR001)                 | ✅ required FK    |
| ProductCost                       | Cost snapshots → margin (PR001)                     | ✅ required FK    |
| ProductMetric                     | Daily performance metrics (PR001)                   | ✅ required FK    |
| TrendSnapshot                     | Trend Hunter snapshots (PR002 + source PR002.1)     | ✅ required FK    |
| TrendKeyword                      | Keyword frequency (PR002)                           | ✅ required FK    |
| TrendCategory                     | Category score (PR002)                              | ✅ required FK    |
| CreatorProfile                    | Creator CRM (PR003: source, niche, score, pipeline) | ✅ required FK    |
| Campaign                          | Orchestration (BRL)                                 | ✅ required FK    |
| Message                           | Conversations                                       | ↳ via relations   |
| Sale                              | Revenue records (BRL)                               | ↳ via relations   |
| CampaignProduct                   | M:N join (campaign ⇄ product)                       | ↳ via campaign    |
| CreatorMetric                     | Daily creator metrics (PR003)                       | ✅ required FK    |
| CreatorTag                        | Creator labels (PR003)                              | ✅ required FK    |
| CampaignCreator                   | M:N join (campaign ⇄ creator)                       | ↳ via campaign    |
| Account/Session/VerificationToken | NextAuth adapter                                    | —                 |

### Product Intelligence Core (PR001)

- **Money** is always integer cents; **margin** is integer basis points
  (`3550` = 35,50%) so the dashboard sorts/filters by margin in SQL.
- `Product.currentCostCents` / `Product.marginBps` are a **denormalized
  snapshot** of the latest `ProductCost`, recomputed automatically by
  `recalculatePricing()` on every price/cost mutation.
- `Product.slug` and `Product.sku` are **tenant-scoped unique**
  (`@@unique([organizationId, slug])`) — two organizations can reuse the same
  slug. Slug is generated automatically from the name (`resolveUniqueSlug`,
  `-2`/`-3`… on collision).
- Variant stock rolls up into `Product.stockQuantity` when variants exist.
- `ProductMetric` is idempotent per `(productId, date)` — safe re-ingestion
  for the future analytics pipeline (PR006).

### Module architecture (mandated from PR001 on)

```
modules/
└── commerce/
    └── products/
        ├── services/       product / media / variant / cost / metric + media-storage (server-only)
        ├── repositories/   tenant-scoped Prisma access — organizationId is ALWAYS the 1st arg
        ├── dto/            serializable shapes crossing the RSC boundary
        ├── pricing/        pure margin math (cents + bps) — fully unit-tested
        └── validators/     Zod schemas + slug helpers — single source of truth for writes
```

### Trend Hunter AI (PR002 · multi-source in PR002.1)

`modules/trends` — the first **Commercial Intelligence** module: stores,
classifies and prioritizes product trends per tenant.

- **Multi-source architecture (PR002.1).** Every snapshot records its origin
  (`TrendSnapshot.source`, Prisma enum `TrendSource`: MOCK · TIKTOK · SHOPEE
  · INSTAGRAM · MANUAL, `@default(MOCK)` — retrocompatible). Collectors live
  in `hunter/collectors/` (one class per source) and are resolved
  **exclusively** by `getCollector(source)` (`hunter/collector.factory.ts`) —
  no `switch` outside the factory (pinned by test). MOCK is implemented
  (30 deterministic candidates); TIKTOK/SHOPEE/INSTAGRAM are placeholders
  that throw `Not implemented`; MANUAL has no collector (dashboard form).
  Still no TikTok API, no scraping, no OpenAI, no Selenium/Playwright/
  Puppeteer — PR002.1 performs zero network calls.
- **TrendCollector contract (PR002.1):** `source: TrendSource` +
  `collect(): Promise<TrendCandidate[]>` (keyword · category · views · likes
  · shares · margin · saturation). `TrendSignal` is kept as a
  retrocompatible alias of `TrendCandidate`, and `collectDailyTrends()`
  remains available as a PR002 alias (the scheduler supports both shapes).
- **Score Engine** (`hunter/scorer.ts`, pure): every component is
  normalized to 0–100, then weighted — Views 30% · Likes 20% · Shares 15% ·
  Margin 20% · Low Saturation 15% — returning an integer 0–100.
- **Scheduler** (`hunter/scheduler.ts`): `SchedulerJob` interface +
  `collect-daily-trends` job (collect → score → validate → persist →
  aggregate keywords/categories). **Manual execution only — no cron.**
- **Repository** (`repositories/trend.repository.ts`):
  `createSnapshot` / `listSnapshots` / `topTrends` / `findKeywords` (+ upserts
  and stats). `organizationId` is ALWAYS the first argument; built through
  `tenantWhere`/`scopedWhere`. Factory (`createTrendRepository(db)`) keeps it
  unit-testable without a database.
- **Keyword slug**: `keywordSlug()` / `normalizeKeyword()`
  (`validators/trend.validator.ts`) canonicalize keywords
  ("Camisa Masculina" → "camisa masculina" → slug `camisa-masculina`).
- The **score is always computed server-side** — a client-supplied score is
  never trusted.

```
modules/
└── trends/
    ├── hunter/          collector (mock, 30 signals) · scorer (pure) · scheduler (manual job)
    ├── repositories/    tenant-scoped Prisma access — organizationId is ALWAYS the 1st arg
    ├── dto/             CreateTrendDTO + serializable RSC shapes
    ├── validators/      Zod schemas (signal / snapshot / list query) + keyword slug helpers
    └── interfaces/      TrendSignal · TrendCollector · TREND_CATEGORIES
```

### Creator Discovery Engine (PR003)

`modules/creators` — the intelligent creator CRM, prepared for TikTok,
Instagram and Shopee (multi-source, mock data only — **no external API is
implemented**, by design).

- **Multi-source architecture.** Every profile records its origin
  (`CreatorProfile.source`, Prisma enum `CreatorSource`: MOCK · TIKTOK ·
  INSTAGRAM · SHOPEE · MANUAL, `@default(MOCK)`). Collectors live in
  `discovery/collectors/` (one class per source) and are resolved
  **exclusively** by `getCreatorCollector(source)`
  (`discovery/collector.factory.ts`) — no `switch` outside the factory
  (pinned by test). MOCK is implemented (100 deterministic candidates);
  TIKTOK/INSTAGRAM/SHOPEE are placeholders that throw `Not implemented`;
  MANUAL has no collector (CRM form). Zero network calls in PR003.
- **Score Engine** (`discovery/scorer.ts`, pure): components normalized to
  0–100 then weighted — Engagement 30% · Frequency 25% · Niche Match 20% ·
  Growth 15% · Quality 10% — returning an integer 0–100
  (`calculateCreatorScore()`). Premium tier from score 80
  (`PREMIUM_CREATOR_SCORE_THRESHOLD`).
- **Scheduler** (`discovery/scheduler.ts`): `CreatorSchedulerJob` interface
  - `discover-creators` job (collect → validate → score → upsert → tags →
    daily metric). **Manual execution only — no cron.** Re-imports refresh
    metrics/score but **never override the CRM status**.
- **CRM** (`crm/`): `createCreatorRepository(db)` exposes `createCreator` ·
  `updateCreator` · `listCreators` · `topCreators` · `changeStatus` (+
  `stats`/`pipeline`/`findById`/`upsertFromDiscovery`/`recordMetric`/`addTag`).
  `organizationId` is ALWAYS the first argument; updates are
  `updateMany` + re-read under `scopedWhere` so a foreign id can never
  match. Handles are canonicalized (`normalizeHandle` → lowercase, single
  leading `@`) and tenant-scoped unique.
- **Pipeline** (`interfaces/creator.interface.ts`):
  NEW → QUALIFIED → CONTACTED → NEGOTIATING → ACTIVE, ARCHIVED as the
  terminal side-state. `CREATOR_STATUS_TRANSITIONS` + `canTransitionCreatorStatus()`
  are the single source of truth — one step forward, one step back,
  archive from anywhere, reactivate only to NEW. Enforced in
  `changeCreatorStatusAction` before any write.
- The **score is always computed server-side** — a client-supplied score is
  never trusted.

```
modules/
└── creators/
    ├── discovery/       collectors (mock, 100 creators) · collector.factory · scorer (pure) · scheduler (manual job)
    ├── crm/             repositories (tenant-scoped) · dto (RSC-serializable) · validators (Zod)
    └── interfaces/      CreatorCandidate · CreatorCollector · pipeline · niches · sources
```

**Dashboard `/dashboard/creators`:** KPIs (Creators · Score Médio ·
Premium · Contatados), tabela (Avatar · Creator · Nicho · Seguidores ·
Score · Status) com busca/filtros (nicho, status, origem)/ordenação/paginação
em URL-state, formulário manual (MANAGER+), Kanban do pipeline e botão
"Executar descoberta" (ADMIN). Seed: 100 mock creators — Moda 35 · Casual
20 · Street 20 · Fitness 15 · Executivo 10, seguidores 5k–2M, pipeline
distribuído (NEW 40% · QUALIFIED 20% · CONTACTED 15% · NEGOTIATING 10% ·
ACTIVE 10% · ARCHIVED 5%), tags e 7 dias de métricas para o top 10.

**Upload de imagens — interface preparada:** `services/media-storage.ts`
defines `MediaStorageProvider` (`createUploadTicket`/`remove`), size/type
policy (10 MB, image mime allowlist) and a `not-configured` placeholder.
Media is attached by URL today; a real provider (S3/R2/UploadThing) plugs in
behind `getMediaStorage()` with zero caller changes.

---

## 6. Migrations

| Migration                                  | Purpose                                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260922000000_init_multitenant`          | Initial schema (nullable `organizationId`)                                                                                                                     |
| `20260922120000_require_organization`      | Promotes `organizationId` to `NOT NULL` on 4 models                                                                                                            |
| `20260922180000_product_intelligence_core` | PR001: 4 new product tables, stock/cost/margin columns, tenant-scoped slug/SKU uniqueness, dashboard indexes                                                   |
| `20260922230000_trend_hunter_ai`           | PR002: TrendSnapshot, TrendKeyword, TrendCategory — all tenant-required FKs, tenant-scoped uniqueness on keyword/category, dashboard indexes                   |
| `20260923050000_trend_source`              | PR002.1: `TrendSource` enum + `TrendSnapshot.source` (`NOT NULL DEFAULT 'MOCK'`, purely additive — no existing row touched) + `(organizationId, source)` index |

The PR000.2 migration is **safe and non-inventive**: it never fabricates an
Organization and never guesses an owner. A `DO $$ … $$` guard counts tenant-less
rows in `User`/`Product`/`CreatorProfile`/`Campaign` and aborts with an actionable
`RAISE EXCEPTION` listing the offending tables, so an operator assigns the
correct tenant before re-running. On a fresh database the guard is a no-op.

---

## 7. Routes

| Route                      | Status | Notes                                                                                              |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `/`                        | ✅     | Landing                                                                                            |
| `/login`                   | ✅     | RHF + Zod → `loginAction` server action → Credentials                                              |
| `/dashboard`               | ✅     | App shell, KPI placeholders                                                                        |
| `/dashboard/products`      | ✅     | PR001 — tabela paginada, busca, filtros (status/margem/preço/estoque), ordenação, KPIs             |
| `/dashboard/products/new`  | ✅     | PR001 — criação (ADMIN only)                                                                       |
| `/dashboard/products/[id]` | ✅     | PR001 — detalhe/edição, mídia, variações, custos & margem                                          |
| `/dashboard/trends`        | ✅     | PR002 — KPIs, tabela com busca/filtro/ordenação/paginação · filtro Origem (PR002.1)                |
| `/dashboard/creators`      | ✅     | PR003 — KPIs, tabela com busca/filtros/ordenação/paginação, Kanban do pipeline, descoberta (ADMIN) |
| `/settings`                | ✅     | Profile + integrations status                                                                      |
| `/api/auth/*`              | ✅     | NextAuth v5 handler (Credentials provider active)                                                  |

Server actions:

- `app/login/actions.ts` → `loginAction()` (generic error, no leak).
- `app/dashboard/products/actions.ts` → 12 actions (product CRUD, media,
  variants, costs, metrics). Every action resolves the tenant from the session
  (`requireAdmin`/`requireManager`), re-validates with Zod, and returns a
  uniform `ActionResult` (never throws to the client).
- `app/dashboard/trends/actions.ts` → 2 actions (PR002 · PR002.1):
  `collectDailyTrendsAction` (executa o job manual — default MOCK) ·
  `createTrendSnapshotAction` (snapshot manual — score always computed
  server-side, stamped `source: MANUAL` since PR002.1). Both
  `requireAdmin()` + tenant-scoped repository.
- `app/dashboard/creators/actions.ts` → 3 actions (PR003):
  `discoverCreatorsAction` (executa o job manual — ADMIN) ·
  `createCreatorAction` (cadastro manual — MANAGER+, sempre
  `source: MANUAL` + `status: NEW`, score server-side) ·
  `changeCreatorStatusAction` (move o pipeline — MANAGER+, transição
  validada contra o mapa antes de qualquer write). All tenant-scoped.

### Products RBAC (PR001)

| Ação                              | ADMIN | MANAGER | MEMBER |
| --------------------------------- | ----- | ------- | ------ |
| Criar produto                     | ✅    | ❌      | ❌     |
| Editar (+ mídia/variações/custos) | ✅    | ✅      | ❌     |
| Excluir produto                   | ✅    | ❌      | ❌     |
| Visualizar                        | ✅    | ✅      | ✅     |

### Trends RBAC (PR002)

| Ação                 | ADMIN | MANAGER | MEMBER               |
| -------------------- | ----- | ------- | -------------------- |
| Executar coleta      | ✅    | ❌      | ❌                   |
| Criar snapshot       | ✅    | ❌      | ❌                   |
| Visualizar dashboard | ✅    | ✅      | ✅ (somente leitura) |

### Creators RBAC (PR003)

| Ação                 | ADMIN | MANAGER | MEMBER               |
| -------------------- | ----- | ------- | -------------------- |
| Executar descoberta  | ✅    | ❌      | ❌                   |
| Criar profile manual | ✅    | ✅      | ❌                   |
| Mover pipeline       | ✅    | ✅      | ❌                   |
| Visualizar dashboard | ✅    | ✅      | ✅ (somente leitura) |

Enforced twice: UI affordances hidden per role **and** re-asserted in every
server action (`requireAdmin`/`requireManager`).

---

## 8. Environment Variables

**Canonical contract (PR000.2) — the runtime reads exactly these four:**

| Variable          | Required | Purpose                                        |
| ----------------- | -------- | ---------------------------------------------- |
| `AUTH_SECRET`     | yes      | NextAuth v5 JWT/session signing secret         |
| `NEXTAUTH_URL`    | prod     | Canonical URL for NextAuth callbacks/redirects |
| `DATABASE_URL`    | yes      | PostgreSQL connection string (Prisma)          |
| `AUTH_TRUST_HOST` | no       | Trust the proxy `Host` header (Render/Docker)  |

Optional: `NODE_ENV`. Local-only seed bootstrap: `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`.

> **Removed in PR000.2:** `APP_URL` and `AUTH_URL` — neither was read by the
> runtime. `APP_NAME` was dropped from the env schema; the app name is a
> compile-time constant in `lib/constants.ts`. `NEXTAUTH_URL` is the single
> canonical deployment URL. Cleaned from `.env.example`, `lib/env.ts` and
> `docker-compose.yml`.

Reserved (NOT implemented): TikTok, OpenAI, Analytics keys.

### Security boundary

`AUTH_SECRET`, `DATABASE_URL` and `passwordHash` are **server-only** and are
never passed to a client component:

- `lib/env.ts` is only imported server-side; no `NEXT_PUBLIC_` variable exists.
- `authorize()` strips `passwordHash` before returning; it never reaches the
  JWT or the session.
- `CurrentUser` (`lib/session.ts`) exposes only
  `id · email · name · image · role · organizationId` — asserted by a test.

---

## 9. Tests

`npm test` (Vitest, `tests/`) — 650+ unit tests, no database required:

| File                               | Covers                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/rbac.test.ts`               | `hasRole`, `isAdmin`, `isManager`, `assertRole`, full hierarchy matrix                                                                                       |
| `tests/session.test.ts`            | `getCurrentUser`, `getCurrentOrganization`, `requireUser`, `requireOrganization`, `requireRole`, `requireAdmin`, `requireManager`, no-secret-leak assertion  |
| `tests/tenant.test.ts`             | `tenantWhere`, `scopedWhere`, `assertSameTenant`, cross-tenant isolation (a caller-supplied `organizationId` cannot override the scope)                      |
| `tests/password.test.ts`           | bcrypt digest shape, salting, verification, no plaintext                                                                                                     |
| `tests/pricing.test.ts`            | PR001 — `totalCostCents`, `profitCents`, `marginBps` (rounding, zero price, negative margin), display helpers                                                |
| `tests/slug.test.ts`               | PR001 — `baseSlug` (accents, fallback, length cap), `resolveUniqueSlug` (`-2`/`-3` collision handling, max length)                                           |
| `tests/product-validators.test.ts` | PR001 — every Zod schema incl. hostile inputs (client-supplied `organizationId` is stripped; hostile sort fields fall back)                                  |
| `tests/product-list-where.test.ts` | PR001 — dashboard filter builder always injects the tenant scope; throws without one                                                                         |
| `tests/products-rbac.test.ts`      | PR001 — products RBAC matrix (ADMIN cria/edita/exclui · MANAGER edita · MEMBER leitura)                                                                      |
| `tests/media-storage.test.ts`      | PR001 — upload policy (mime allowlist, 10 MB cap) + placeholder provider contract                                                                            |
| `tests/trend-scorer.test.ts`       | PR002 — score engine: weights (30/20/15/20/15), normalization to 0–100, clamping, rounding, guard errors                                                     |
| `tests/trend-collector.test.ts`    | PR002 — mock collector: exactly 30 valid unique signals, 5 categories, scores 60–98, deterministic + defensive copies (+ PR002.1 `collect()` alias)          |
| `tests/trend-validators.test.ts`   | PR002 — Zod schemas (signal/snapshot/list query) incl. hostile inputs + `keywordSlug`/`normalizeKeyword` (accents, fallback, length cap)                     |
| `tests/trend-repository.test.ts`   | PR002 — repository against an in-memory fake Prisma: tenant always injected, blank tenant throws before ANY db call, cross-tenant invisibility, filters      |
| `tests/trend-scheduler.test.ts`    | PR002 — `collect-daily-trends` job (collect → score → validate → persist → aggregate), failure handling, manual-only contract (+ PR002.1 multi-source)       |
| `tests/trend-source.test.ts`       | PR002.1 — `TrendSource` enum ↔ `TREND_SOURCES` sync, labels, MOCK default, Zod source schemas (accept/reject/defaults), URL-state `?source=`                 |
| `tests/collector-factory.test.ts`  | PR002.1 — `getCollector()` mapping per source, placeholder collectors throw "Not implemented", MANUAL/unknown throw, singleton cache, no-switch architecture |
| `tests/trends-rbac.test.ts`        | PR002 — trends RBAC matrix (ADMIN coleta/cria · MANAGER visualiza · MEMBER leitura)                                                                          |
| `tests/trend-dto.test.ts`          | PR002 — DTO mappers: ISO serialization across the RSC boundary, score computed engine-side                                                                   |

---

## 10. Not Implemented (interface only)

- TikTok API / scraping — `modules/integrations/tiktok`. The Trend
  Hunter's and the Creator Discovery's real sources both land here
  (behind their collectors).
- AI provider (OpenAI) — `modules/integrations/ai` (PR004)
- Automated outreach (messages) — PR006; the CRM pipeline stops at ACTIVE
- Trend Hunter real sources — collectors are placeholders behind
  `getCollector()` since PR002.1; MOCK is the only implemented source
- Creator Discovery real sources (TikTok · Instagram · Shopee) —
  placeholders behind `getCreatorCollector()` since PR003; MOCK is the
  only implemented source (no external API, by design)
- Cron/scheduler wiring for `collect-daily-trends` / `discover-creators` —
  manual trigger only
- Analytics pipeline — `modules/analytics` (PR007)

---

## 11. Changelog

### PR003 — Creator Discovery Engine (2026-09-22) — completed

Intelligent creator CRM, multi-source prepared for TikTok, Instagram and
Shopee — running entirely on **mock data** (no external API, no scraping,
no OpenAI; zero network calls).

- **Prisma** — `CreatorSource` + `CreatorStatus` (NEW · QUALIFIED ·
  CONTACTED · NEGOTIATING · ACTIVE · ARCHIVED) enums; the PR000 `Creator`
  stub became `CreatorProfile` (renamed — data preserved) gaining
  `source`, `niche`, `avgViews`, `engagementRate`, `creatorScore` and
  tenant-scoped uniques (`(organizationId, handle)` ·
  `(organizationId, source, externalId)` · `(organizationId, email)`).
  New child models `CreatorMetric` (daily snapshots, unique per
  creator+date) and `CreatorTag` — both with required denormalized
  `organizationId`. Migration `20260923120000_creator_discovery_engine`
  remaps the old status values in place (PROSPECT→NEW, INVITED→CONTACTED,
  PAUSED→ARCHIVED) and keeps the campaign/message/sale FKs pointing at the
  renamed table.
- **Module** (`modules/creators/`): `discovery/` (collectors ·
  collector.factory · scorer · scheduler) + `crm/` (repositories · dto ·
  validators) + `interfaces/` — the mandated PR003 layout. Legacy
  `modules/creators/creators.service.ts` removed (superseded).
- **Score engine** — `calculateCreatorScore()`: Engagement 30 · Frequency
  25 · Niche Match 20 · Growth 15 · Quality 10 → integer 0–100, always
  computed server-side.
- **Factory + collectors** — `getCreatorCollector(source)` with lazy
  singletons; `MockCreatorCollector` (100 deterministic candidates) is the
  only implementation; TikTok/Instagram/Shopee are tested placeholders.
- **CRM repository** — `createCreator` · `updateCreator` · `listCreators`
  · `topCreators` · `changeStatus` (+ `stats`, `pipeline`, discovery
  upsert, metrics, tags) — every function organization-scoped.
- **Dashboard** — `/dashboard/creators`: KPIs (Creators · Score Médio ·
  Premium · Contatados), tabela com busca/filtros/ordenação/paginação,
  cadastro manual (MANAGER+), Kanban do pipeline, descoberta manual
  (ADMIN). Sidebar "Creators" un-flagged as planned.
- **Seed** — 100 mock creators (Moda 35 · Casual 20 · Street 20 · Fitness
  15 · Executivo 10; 5k–2M followers) via the real pipeline, pipeline
  spread across the six statuses, tags and 7-day metrics for the top 10.
- **Tests** — +206 unit tests (503 total): factory, score, repository
  (in-memory fake Prisma), RBAC, tenant, pipeline, validators, scheduler,
  DTOs, enum sync.

### PR002.1 — Multi-Source Data Architecture (2026-09-22) — completed

Datasource hotfix: prepares the Trend Hunter for multiple data sources
**without changing current behaviour** (screens, APIs, Score Engine and the
public repository surface untouched; fully retrocompatible).

- **Prisma** — `TrendSource` enum (MOCK · TIKTOK · SHOPEE · INSTAGRAM ·
  MANUAL) + `TrendSnapshot.source @default(MOCK)` + tenant/source index.
  Migration `20260923050000_trend_source` is purely additive: existing rows
  become MOCK, nothing is removed or rewritten.
- **DTO/validators** — `CreateTrendDTO.source?` (default MOCK),
  `trendSourceSchema`, `source` on the persisted schema and on the
  dashboard list query (absent = all sources — existing calls unchanged).
- **Collectors** — `hunter/collectors/` with `MockCollector` (moved from
  `collector.ts`, data preserved) + `TikTokCollector`, `ShopeeCollector`,
  `InstagramCollector` placeholders throwing `Not implemented`.
  `TrendCandidate` is the canonical signal shape (`TrendSignal` kept as an
  alias); `TrendCollector` gains `source: TrendSource` + `collect()` with
  `collectDailyTrends()` kept as a PR002 alias.
- **Collector factory** — `hunter/collector.factory.ts` → `getCollector(source)`
  is the only source→collector resolution point (map-based; no `switch`
  anywhere in the module, enforced by test). `MANUAL` throws by design.
  `hunter/collector.ts` remains as a retrocompatible façade.
- **Scheduler** — `createCollectDailyTrendsJob({ source })` (default MOCK —
  behaviour unchanged); every snapshot is stamped with the collector's
  source and the job result reports it. Placeholder sources fail gracefully
  (`Not implemented` → failed result, never a throw).
- **Repository** — `listSnapshots` accepts an optional `source` filter
  (tenant scope still merged last). Public surface otherwise unchanged.
- **Dashboard** — new **Origem** filter (Todos · Mock · TikTok · Shopee ·
  Instagram · Manual, initial value Todos, URL-state `?source=`); manual
  form creations are stamped `MANUAL`. No other screen changes.
- **Tests** — 297 total (+54): enum sync, factory, placeholders, scheduler
  multi-source, repository source filter, DTO source stamping.
- **Docs** — README "Data Sources" section, module tree, roadmap row;
  modules/README updated.

### PR002 — Trend Hunter AI (2026-09-22) — completed

**Delivery workflow (instituted in PR001):** feature branch → Pull Request →
human audit → approval → merge → Render deploy. No direct merges to `main`.

**Schema (migration `20260922230000_trend_hunter_ai`)**

- New models: `TrendSnapshot`, `TrendKeyword`, `TrendCategory` — all with a
  **required `organizationId`** FK (`onDelete: Cascade`), `id`, `createdAt`,
  `updatedAt`.
- `TrendKeyword` / `TrendCategory` are **tenant-scoped unique**
  (`(organizationId, keyword)` / `(organizationId, name)`).
- Dashboard indexes on `(organizationId, trendScore|category|createdAt)`.

**Module (`modules/trends/`)**

- `hunter/collector.ts` — `TrendCollector` interface + **mock source** with
  exactly 30 daily trends across Moda/Casual/Street/Executivo/Fitness. NO
  TikTok API, NO scraping, NO OpenAI, NO browser automation — by design.
- `hunter/scorer.ts` — pure **Score Engine**: normalization to 0–100 +
  weights (Views 30% · Likes 20% · Shares 15% · Margin 20% · Low Saturation
  15%) → integer score. Fully unit-tested.
- `hunter/scheduler.ts` — `SchedulerJob` interface + `collect-daily-trends`
  job (manual execution only; `schedule` reserved for a future PR).
- `repositories/trend.repository.ts` — `createSnapshot`, `listSnapshots`,
  `topTrends`, `findKeywords` (+ `upsertKeyword`, `upsertCategory`, `stats`).
  Every query takes `organizationId` first — **no query without tenant**.
- `validators/trend.validator.ts` — Zod schemas + keyword slug helpers.
- `dto/create-trend.dto.ts` — `CreateTrendDTO` + RSC-serializable shapes.

**UI (`/dashboard/trends`)**

- KPI cards: Maior Score · Keywords · Categorias · Última Coleta.
- Tabela Keyword · Categoria · Views · Likes · Score com **busca**,
  **filtro por categoria**, **ordenação** por coluna e **paginação**
  (URL-state) — responsivo.
- "Executar coleta" (ADMIN) dispara o job manual; "Nova tendência"
  (ADMIN) cria um snapshot manual com score calculado no servidor.

**RBAC** — ADMIN executa coleta/cria snapshot · MANAGER visualiza · MEMBER
somente leitura (re-afirmado em cada server action via `requireAdmin()`).

**Seed** — 30 tendências via o pipeline real (mock collector → score
engine), scores 60–98, keywords com frequência e categorias com score
médio. Idempotente (não re-insere nem apaga coletas reais).

**Tests** — +126 unit tests (240 total): score engine, collector, slug de
keyword, repository (fake Prisma in-memory) com tenant isolation, scheduler,
RBAC, DTOs.

### PR001 — Product Intelligence Core (2026-09-22) — completed

**Delivery workflow (instituted here):** feature branch → Pull Request →
human audit → approval → merge → Render deploy. No direct merges to `main`.

**Schema (migration `20260922180000_product_intelligence_core`)**

- New models: `ProductMedia`, `ProductVariant`, `ProductCost`, `ProductMetric`
  — all with a **required, denormalized `organizationId`** FK for direct
  scoped queries.
- `Product` gained `stockQuantity`, `currentCostCents`, `marginBps`
  (denormalized snapshot) with dashboard indexes on
  `(organizationId, status|marginBps|priceCents)`.
- `Product.slug`/`sku` moved from global to **tenant-scoped** uniqueness.

**Module (`modules/commerce/products/`)**

- Mandated layout: `services/ · repositories/ · dto/ · pricing/ · validators/`.
- Repositories: `organizationId` is the first argument of every function;
  updates/deletes are `updateMany/deleteMany` under `scopedWhere` so a foreign
  id can never match.
- `pricing/margin.ts`: pure, unit-tested margin math (integer cents → bps).
- **Cálculo automático de margem:** `recalculatePricing()` runs on every
  price/cost mutation.
- **Slug automático:** `resolveUniqueSlug` derives from the name, pt-BR
  accents stripped, `-2`/`-3`… on tenant-scoped collision.
- **Upload preparado:** `MediaStorageProvider` interface + policy + placeholder
  (media by URL works today; binary provider is plug-in later).
- Legacy `modules/products/products.service.ts` removed (superseded).

**UI (`/dashboard/products`)**

- Paginated table (URL-state) with busca (nome/slug/SKU, debounced), filtros
  (status, margem mínima, preço máximo, estoque), ordenação por coluna
  (nome/preço/margem/estoque), KPI cards (total, ativos, estoque, margem média).
- Create page (ADMIN), detail page with edit form (MANAGER+), media gallery,
  variants panel, cost history with automatic margin recalc badge.
- RBAC-aware affordances; MEMBER gets a read-only view.

**Server actions** — `app/dashboard/products/actions.ts`: 12 actions, all
`requireAdmin`/`requireManager` + Zod + tenant-scoped services, uniform
`ActionResult` envelope.

**Tests** — +63 unit tests (114 total): pricing, slug, validators (hostile
input), tenant filter builder, RBAC matrix, media-storage policy.

**Misc**

- `lib/prisma.ts`: optional `DATABASE_POOL_MAX` env to cap the pg pool.
- Seed updated: tenant-scoped upsert key + initial cost snapshot with margin.
- Sidebar: "Produtos" no longer flagged as planned.

### PR000.2 — Tenant & Auth Hardening (2026-09-22) — completed

**Tenancy hardening**

- `organizationId` promoted `String?` → `String` on `User`, `Product`,
  `Creator`, `Campaign`, with required `Organization` relations.
- New `lib/tenant.ts`: `assertOrganizationId`, `tenantWhere`, `scopedWhere`,
  `assertSameTenant`.
- All domain services now require `organizationId` as their first argument;
  no query runs unscoped.

**Auth hardening**

- Credentials provider (email + password) wired on NextAuth v5 + Prisma adapter.
- `lib/password.ts`: bcrypt hashing (cost 12), verification, timing equalization.
- Login form now submits to the `loginAction` server action; generic error only.
- No public sign-up; seed is the only bootstrap path and stores a hash only.

**Migrations**

- `20260922120000_require_organization` with a guard that aborts on tenant-less
  rows instead of inventing data.

**Routes**

- `app/login/actions.ts` (server action) added; `/login` now performs a real
  credentials sign-in.

**Tests**

- Vitest added; 51 tests across RBAC, session guards, tenancy and passwords.
- CI extended: `npm ci` → `prisma validate` → `generate` → `lint` →
  `typecheck` → `test` → `build` → `format:check`.

**Environment**

- Contract standardized to `AUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`,
  `AUTH_TRUST_HOST`; `APP_URL`/`AUTH_URL` removed everywhere.

### PR000.1 — Architecture Hotfix (2026-09-22)

- All currencies `USD → BRL` (schema defaults, seed, `formatCurrency`).
- Added `Organization` model (tenant boundary).
- Related `User`, `Product`, `Creator`, `Campaign` to `Organization`.
- Removed `APP_URL` from `render.yaml`; added `NEXTAUTH_URL`.
- Initial RBAC for `ADMIN` in `lib/auth.ts` (`hasRole`, `isAdmin`, `requireAdmin`).
- README updated for multi-tenant architecture.
- Added initial Prisma migration `20260922000000_init_multitenant`.
- Added this `PROJECT_STATE.md`.

### PR000 — Bootstrap Foundation

- Project scaffolding, dark premium UI shell, Prisma schema (6 core models),
  NextAuth v5 wiring, Docker, `render.yaml`, GitHub Actions CI/CD.

---

## 12. Roadmap

| PR                                 | Title                             | Status  |
| ---------------------------------- | --------------------------------- | ------- |
| PR000                              | Bootstrap Foundation              | ✅ done |
| PR000.1                            | Architecture Hotfix               | ✅ done |
| PR000.2                            | Tenant & Auth Hardening           | ✅ done |
| PR001                              | Product Intelligence Core         | ✅ done |
| PR002                              | Trend Hunter AI                   | ✅ done |
| PR002.1                            | Multi-Source Data Architecture    | ✅ done |
| PR003                              | Creator Discovery Engine          | ✅ done |
| PR004                              | Outreach AI & Sales Pipeline      | ✅ this |
| PR005                              | Campaign Engine                   | ⏭ next  |
| PR006                              | Messaging & Inbox                 | planned |
| PR007                              | Analytics & Reporting             | planned |
| PR008                              | Billing & Multi-tenancy hardening | planned |
| a guard that aborts on tenant-less |
| rows instead of inventing data.    |

**Routes**

- `app/login/actions.ts` (server action) added; `/login` now performs a real
  credentials sign-in.

**Tests**

- Vitest added; 51 tests across RBAC, session guards, tenancy and passwords.
- CI extended: `npm ci` → `prisma validate` → `generate` → `lint` →
  `typecheck` → `test` → `build` → `format:check`.

**Environment**

- Contract standardized to `AUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`,
  `AUTH_TRUST_HOST`; `APP_URL`/`AUTH_URL` removed everywhere.

### PR000.1 — Architecture Hotfix (2026-09-22)

- All currencies `USD → BRL` (schema defaults, seed, `formatCurrency`).
- Added `Organization` model (tenant boundary).
- Related `User`, `Product`, `Creator`, `Campaign` to `Organization`.
- Removed `APP_URL` from `render.yaml`; added `NEXTAUTH_URL`.
- Initial RBAC for `ADMIN` in `lib/auth.ts` (`hasRole`, `isAdmin`, `requireAdmin`).
- README updated for multi-tenant architecture.
- Added initial Prisma migration `20260922000000_init_multitenant`.
- Added this `PROJECT_STATE.md`.

### PR000 — Bootstrap Foundation

- Project scaffolding, dark premium UI shell, Prisma schema (6 core models),
  NextAuth v5 wiring, Docker, `render.yaml`, GitHub Actions CI/CD.

---

## 12. Roadmap

| PR      | Title                             | Status  |
| ------- | --------------------------------- | ------- |
| PR000   | Bootstrap Foundation              | ✅ done |
| PR000.1 | Architecture Hotfix               | ✅ done |
| PR000.2 | Tenant & Auth Hardening           | ✅ done |
| PR001   | Product Intelligence Core         | ✅ done |
| PR002   | Trend Hunter AI                   | ✅ done |
| PR002.1 | Multi-Source Data Architecture    | ✅ done |
| PR003   | Creator Discovery Engine          | ✅ done |
| PR004   | Outreach AI & Sales Pipeline      | ✅ this |
| PR005   | Campaign Engine                   | ⏭ next  |
| PR006   | Messaging & Inbox                 | planned |
| PR007   | Analytics & Reporting             | planned |
| PR008   | Billing & Multi-tenancy hardening | planned |

## PR004 — Outreach AI & Sales Pipeline (2026-09-22)

### Status: implemented

- **Outreach AI:** `/dashboard/outreach` includes five KPIs, tenant-scoped outbox, creator/product/template data, and message actions.
- **Prompt Engine:** deterministic `generateOutreachMessage()` with no OpenAI, provider SDK, `eval`, scraping, or network call.
- **Templates:** 8 workspace templates: 3 `FIRST_CONTACT`, 2 `FOLLOW_UP`, 2 `NEGOTIATION`, 1 `REENGAGEMENT`.
- **Outbox:** `createDraft`, `scheduleMessage`, `cancelMessage`, `listOutbox`, and `stats`; every operation requires `organizationId`.
- **Follow-up:** 1st contact and +3/+7/+15-day cadence generated as DRAFT payloads.
- **Scheduler:** due scheduled records become `READY`; PR004 never sends a message or marks it `SENT` automatically.
- **Editor:** live preview, character counter, save, regenerate, schedule, and cancel through server actions.
- **RBAC:** ADMIN manages templates/cancellation/scheduling; MANAGER generates, edits, regenerates and schedules; MEMBER is read-only.
- **Prisma:** `OutreachStatus`, `TemplateType`, `OutreachMessage`, `MessageTemplate`, and `FollowUpSequence`, all tenant-scoped.
- **Seed:** 8 templates, 40 drafts, 15 scheduled, 5 sent fixtures, and 3 failed fixtures, using existing creators/products.
- **Integrations explicitly excluded:** WhatsApp, TikTok, Instagram, real delivery and OpenAI.

### PR004 module layout

```text
modules/outreach/
├── prompts/       generator.ts · templates.ts · variables.ts
├── queue/         outbox.repository.ts · scheduler.ts
├── crm/           followup.ts
├── dto/           create-message.dto.ts
├── validators/    outreach.validator.ts
└── interfaces/    outreach.interface.ts
```

### Next: PR005

Delivery-provider interfaces, campaign automation and delivery observability may consume `READY` outbox records. PR005 must keep providers behind adapters and must not bypass tenant scope, server-side RBAC, consent or audit controls.
