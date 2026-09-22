# PROJECT STATE — Brobond AI Commerce OS

> Living document tracking the architectural state of the platform.
> Updated per PR. Source of truth for "what exists" vs. "what is planned".

**Last updated:** 2026-09-22
**Current PR:** PR006 — Campaign Engine & AI Matching
**Status:** completed (awaiting review/merge — **no merge performed**)
**Branch:** `arena/01a0cb31-brobond-ai-commerce` (Arena session branch; requested spec branch: `feature/pr006-campaign-engine`)
**Next PR:** PR007 — Analytics & Attribution

> **Workflow (instituted in PR001):** no more direct merges to `main`.
> Feature branch → Pull Request → human audit → approval → merge → Render deploy.

---

## 1. Snapshot

| Aspect       | State                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage        | Campaign Engine & AI Matching (PR006) shipped                                                                                                                                                                                                                             |
| Architecture | **Multi-tenant, enforced** (`organizationId` NOT NULL on domain models) · **multi-source trends** (PR002.1)                                                                                                                                                               |
| Modules      | `modules/commerce/products` — services / repositories / dto / pricing / validators                                                                                                                                                                                        |
|              | `modules/trends` — hunter (collectors / collector factory / scorer / scheduler) / repositories / dto / …                                                                                                                                                                  |
|              | `modules/connectors` — core (interface / factory / validator / dto / repository / sync) + mock / tiktok / instagram / shopee (PR005)                                                                                                                                      |
|              | `modules/campaigns` — Campaign Engine · deterministic AI Matching · ROI Engine · Audience Builder · repositories · dto · validators (PR006)                                                                                                                               |
| Currency     | **BRL** (default across Product, Campaign, Sale) · money = integer cents · margin = basis points                                                                                                                                                                          |
| Auth         | NextAuth v5 (Prisma adapter, JWT) + **Credentials provider (email/senha)**                                                                                                                                                                                                |
| RBAC         | ADMIN > MANAGER > MEMBER — products: ADMIN cria/edita/exclui · MANAGER edita · MEMBER somente leitura                                                                                                                                                                     |
| Database     | PostgreSQL via Prisma (pg driver adapter, Rust-free client)                                                                                                                                                                                                               |
| Migrations   | `…_init_multitenant` · `…_require_organization` · `…_product_intelligence_core` · `…_trend_hunter_ai` · `…_trend_source` · `…_creator_discovery_engine` · `…_outreach_ai_sales_pipeline` · `…_connector_framework` · `…_product_match_architecture` · `…_campaign_engine` |
| Tests        | Vitest — 1,017 unit tests (RBAC, session, tenancy, passwords, pricing, slug, validators, filters, storage, trends, creators, outreach, connectors, matches)                                                                                                               |
| Deploy       | Render Blueprint (`render.yaml`) + GitHub Actions                                                                                                                                                                                                                         |
| Build/CI     | ✅ green (ci → validate → generate → lint → typecheck → test → build → format)                                                                                                                                                                                            |

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

| Model                             | Purpose                                                 | Tenant-scoped     |
| --------------------------------- | ------------------------------------------------------- | ----------------- |
| Organization                      | Tenant boundary                                         | — (is the tenant) |
| User                              | Team members + roles                                    | ✅ required FK    |
| Product                           | Catalog (BRL, stock, cost, margin)                      | ✅ required FK    |
| ProductMedia                      | Product images/videos (PR001)                           | ✅ required FK    |
| ProductVariant                    | Sellable variations + stock (PR001)                     | ✅ required FK    |
| ProductCost                       | Cost snapshots → margin (PR001)                         | ✅ required FK    |
| ProductMetric                     | Daily performance metrics (PR001)                       | ✅ required FK    |
| TrendSnapshot                     | Trend Hunter snapshots (PR002 + source PR002.1)         | ✅ required FK    |
| TrendKeyword                      | Keyword frequency (PR002)                               | ✅ required FK    |
| TrendCategory                     | Category score (PR002)                                  | ✅ required FK    |
| CreatorProfile                    | Creator CRM (PR003: source, niche, score, pipeline)     | ✅ required FK    |
| Campaign                          | Orchestration + audience strategy (BRL)                 | ✅ required FK    |
| Message                           | Conversations                                           | ↳ via relations   |
| Sale                              | Revenue records (BRL)                                   | ↳ via relations   |
| CampaignProduct                   | M:N join (campaign ⇄ product)                           | ↳ via campaign    |
| CreatorMetric                     | Daily creator metrics (PR003)                           | ✅ required FK    |
| CreatorTag                        | Creator labels (PR003)                                  | ✅ required FK    |
| ConnectorStatus                   | Per-platform connector state + counters (PR005)         | ✅ required FK    |
| ExternalContent                   | Imported external content + dedupe (PR005)              | ✅ required FK    |
| ProductMatch                      | Content ⇄ product correspondence + confidence (PR005.1) | ✅ required FK    |
| CampaignAudience                  | Ranked creator/product recommendations (PR006)          | ✅ required FK    |
| CampaignRule                      | Campaign eligibility thresholds (PR006)                 | ✅ required FK    |
| CampaignCreator                   | M:N join (campaign ⇄ creator)                           | ↳ via campaign    |
| Account/Session/VerificationToken | NextAuth adapter                                        | —                 |

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

### Campaign Engine & AI Matching (PR006)

- `calculateMatchScore()` is deterministic: TrendScore 30% · CreatorScore 30% · margin 20% · niche 20%.
- `recommendCreators()` ranks creator/product pairs using tenant-owned Campaign, Product, CreatorProfile, ProductMatch and TrendSnapshot data only.
- `buildCampaign()` applies CampaignRule eligibility and persists CampaignAudience snapshots.
- `estimateROI()` projects revenue, gross margin, commission, freight, profit and ROI%.
- Dashboard `/dashboard/campaigns`: recommended creators, products, average score, projected ROI and audience table.
- Seed: 5 campaigns and 200 recommendations produced by the real matcher. No OpenAI, TikTok integration, message sending, randomness or external call.

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

### Connector Framework (PR005)

`modules/connectors` — the multi-platform ingestion architecture, prepared
for TikTok, Instagram and Shopee. **PR005 delivers the ARCHITECTURE ONLY:
no real API is integrated** — zero network calls, zero SDKs, zero scraping,
zero credentials anywhere in the module.

- **Multi-platform architecture.** Every adapter declares its
  `ConnectorPlatform` (Prisma enum: MOCK · TIKTOK · INSTAGRAM · SHOPEE),
  lives in `modules/connectors/<platform>/` and is resolved **exclusively**
  by `getConnector(platform)` (`core/connector.factory.ts`) — no `switch`
  outside the factory (pinned by test). MOCK is implemented (40
  deterministic items: 36 unique + 4 deliberate duplicates);
  TIKTOK/INSTAGRAM/SHOPEE are placeholders that throw
  `ConnectorNotImplementedError`.
- **Connector contract** (`core/connector.interface.ts`):
  `platform` · `name` · `implemented` · `fetchContent(options?)` ·
  `testConnection()`. `fetchContent` returns `NormalizedContent[]`
  (externalId · type · title · url · thumbnail · author · caption ·
  views/likes/shares · publishedAt · raw) — the adapter is the ONLY place
  that knows a provider's payload shape. `testConnection()` **never
  throws**: a placeholder reports `{ ok: false, implemented: false }` so
  the dashboard renders calmly.
- **Sync service** (`core/connector.sync.ts`): the `sync-connector` job —
  fetch → validate each item (Zod) → dedupe → persist as IMPORTED /
  DUPLICATE / FAILED → update the connector state and counters.
  **Manual execution only — no cron** (`schedule` is deliberately
  `undefined`, same contract as PR002/PR003). An adapter may only
  _describe_ content; the import **outcome is decided by the service**,
  never by the connector. A placeholder sync is a recorded ERROR, never a
  crash; a partial failure keeps the connector ACTIVE.
- **Dedupe contract:** `(organizationId, platform, externalId)` is UNIQUE.
  A re-import is recorded as DUPLICATE and refreshes the known row's
  engagement numbers instead of creating a second record — this is what
  makes the "Duplicados" KPI meaningful. The key is tenant-scoped, so two
  workspaces may import the same item independently.
- **Repository** (`core/connector.repository.ts`): `listStatuses` ·
  `findStatus` · `ensureStatus` · `setEnabled` · `recordSyncResult` ·
  `createContent` · `findContentByExternalId` · `refreshContent` ·
  `listContent` · `kpis`. `organizationId` is ALWAYS the first argument,
  built through `tenantWhere`/`scopedWhere`. Factory
  (`createConnectorRepository(db)`) keeps it unit-testable without a
  database.
- **Connector state:** IDLE (registered, never synced) · ACTIVE (last sync
  succeeded) · ERROR (last sync failed) · DISABLED (ADMIN toggle). The
  "Conectores ativos" KPI counts `enabled && state === ACTIVE` —
  `isConnectorActive()` is the single source of truth.
- **No credentials by design.** `ConnectorStatus` has no token/secret
  column. A future PR must add a _secret reference_ resolved server-side,
  never a raw token in the database or the client bundle.

```
modules/
└── connectors/
    ├── core/       connector.interface · connector.factory · connector.validator ·
    │               connector.dto · connector.repository (server-only) ·
    │               connector.sync (server-only, manual job)
    ├── mock/       MockConnector — implemented (deterministic dataset)
    ├── tiktok/     TikTokConnector — placeholder
    ├── instagram/  InstagramConnector — placeholder
    └── shopee/     ShopeeConnector — placeholder
```

**Dashboard `/dashboard/connectors`:** KPIs (Importados · Duplicados ·
Falhas · Conectores ativos), grid com um card por conector (estado,
contadores, última sincronização, erro) e ações ADMIN (Sincronizar ·
Ativar/Desativar · Testar), além da tabela de conteúdo importado com
busca/filtros (plataforma, status, tipo)/ordenação/paginação em URL-state.
Seed: 36 itens importados + 4 duplicados no conector Mock (ativo) e os três
placeholders registrados como IDLE/desativados.

**Upload de imagens — interface preparada:** `services/media-storage.ts`
defines `MediaStorageProvider` (`createUploadTicket`/`remove`), size/type
policy (10 MB, image mime allowlist) and a `not-configured` placeholder.
Media is attached by URL today; a real provider (S3/R2/UploadThing) plugs in
behind `getMediaStorage()` with zero caller changes.

---

### Product Matching Engine (PR005.1)

`modules/campaigns` — the layer that answers **"este vídeo vende este
produto?"** by relating imported external content (PR005) to internal
products (PR001). **Deterministic rules ONLY: no OpenAI, no computer
vision, no embeddings, no TikTok integration** — every correspondence is
decided by four text rules and normalized to a 0.00–1.00 confidence.

- **Prisma.** `MatchSource` enum (AI · MANUAL · RULE) + `ProductMatch`
  model — `organizationId` / `externalContentId` / `productId` (all
  required FKs, Cascade), `confidence Float`, `matchedBy MatchSource`.
  Unique `(externalContentId, productId)`: one row per content/product
  pair; tenant + confidence indexes. Migration
  `20260923220000_product_match_architecture` is purely ADDITIVE.
- **Matcher Engine** (`matching/matcher.ts`, pure):
  `matchProductsToContent(contents, products)` scores every pair with the
  four rules — **+40** keyword in the title · **+25** category coincides ·
  **+20** slug appears in the content text · **+15** partial word (≥ 4
  chars) — discards zero-score pairs and returns drafts sorted by
  confidence (desc, stable id tiebreakers). Accepts plain Prisma rows
  (structural `MatchableContent`/`MatchableProduct` views); categories are
  derived deterministically from the first significant token of the title
  / slug until real category columns exist. Stamps `matchedBy: RULE`.
- **Confidence Score** (`matching/scorer.ts`, pure):
  `calculateMatchConfidence(points)` normalizes 0–100 → 0.00–1.00, rounds
  to two decimals and clamps both ends — **the result is never above 1**
  (garbage input collapses to 0 instead of throwing).
- **Repository** (`repositories/product-match.repository.ts`):
  `createMatch` · `listMatches` · `findByContent` · `findByProduct` ·
  `approveMatch` · `deleteMatch` · `kpis`. `organizationId` is ALWAYS the
  first argument; `createMatch` refuses foreign content/product ids (FK
  ownership check before any write). Factory
  (`createProductMatchRepository(db)`) keeps it unit-testable without a
  database.
- **DTO + Zod** (`dto/` + `validators/`): `CreateProductMatchDTO`
  (externalContentId · productId · confidence · matchedBy) with the
  confidence validated to 0–1 and rounded to 2 decimals;
  `organizationId` is never accepted from the client. RSC-serializable
  item/page/KPI DTOs derive the review **Status** from the origin
  (MANUAL → Aprovado · AI/RULE → Pendente).
- **Dashboard** `/dashboard/matches`: KPIs (**Conteúdos importados ·
  Matches automáticos · Pendentes (conteúdos sem nenhum match) ·
  Confiança média**) and a table **Vídeo · Produto · Confidence · Origem ·
  Status** ordered by confidence, with URL-state search + pagination and
  the Aprovar/Remover affordances.
- **Server actions** (`app/dashboard/matches/actions.ts`):
  `createProductMatch()` · `approveMatch()` · `removeMatch()` — every
  write is `requireManager()`; approve promotes the match to MANUAL with
  confidence 1.00 (the human word is definitive).

```
modules/
└── campaigns/
    ├── matching/        matcher.ts (rules engine) · scorer.ts (confidence) · match-source.ts (client-safe mirrors)
    ├── repositories/    product-match.repository.ts — organizationId is ALWAYS the 1st arg
    ├── dto/             CreateProductMatchDTO + serializable RSC shapes
    └── validators/      Zod schemas (create / approve / remove / list query)
```

---

## 6. Migrations

| Migration                                   | Purpose                                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260922000000_init_multitenant`           | Initial schema (nullable `organizationId`)                                                                                                                                                                                                        |
| `20260922120000_require_organization`       | Promotes `organizationId` to `NOT NULL` on 4 models                                                                                                                                                                                               |
| `20260922180000_product_intelligence_core`  | PR001: 4 new product tables, stock/cost/margin columns, tenant-scoped slug/SKU uniqueness, dashboard indexes                                                                                                                                      |
| `20260922230000_trend_hunter_ai`            | PR002: TrendSnapshot, TrendKeyword, TrendCategory — all tenant-required FKs, tenant-scoped uniqueness on keyword/category, dashboard indexes                                                                                                      |
| `20260923050000_trend_source`               | PR002.1: `TrendSource` enum + `TrendSnapshot.source` (`NOT NULL DEFAULT 'MOCK'`, purely additive — no existing row touched) + `(organizationId, source)` index                                                                                    |
| `20260923120000_creator_discovery_engine`   | PR003: `Creator` → `CreatorProfile` (data preserved), `CreatorSource`, CRM columns, `CreatorMetric`, `CreatorTag`, tenant-scoped uniques                                                                                                          |
| `20260922194600_outreach_ai_sales_pipeline` | PR004: `OutreachStatus`, `TemplateType`, `OutreachMessage`, `MessageTemplate`, `FollowUpSequence` — all tenant-required FKs                                                                                                                       |
| `20260923180000_connector_framework`        | PR005: `ConnectorPlatform`/`ConnectorState`/`ExternalContentType`/`ExternalContentStatus` enums + `ConnectorStatus` + `ExternalContent` — purely ADDITIVE, dedupe unique `(organizationId, platform, externalId)`, no credential column by design |
| `20260923220000_product_match_architecture` | PR005.1: `MatchSource` enum + `ProductMatch` (content ⇄ product link, 0–1 confidence) — purely ADDITIVE, unique `(externalContentId, productId)`, Cascade on organization/content/product                                                         |

The PR000.2 migration is **safe and non-inventive**: it never fabricates an
Organization and never guesses an owner. A `DO $$ … $$` guard counts tenant-less
rows in `User`/`Product`/`CreatorProfile`/`Campaign` and aborts with an actionable
`RAISE EXCEPTION` listing the offending tables, so an operator assigns the
correct tenant before re-running. On a fresh database the guard is a no-op.

---

## 7. Routes

| Route                      | Status | Notes                                                                                                            |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `/`                        | ✅     | Landing                                                                                                          |
| `/login`                   | ✅     | RHF + Zod → `loginAction` server action → Credentials                                                            |
| `/dashboard`               | ✅     | App shell, KPI placeholders                                                                                      |
| `/dashboard/products`      | ✅     | PR001 — tabela paginada, busca, filtros (status/margem/preço/estoque), ordenação, KPIs                           |
| `/dashboard/products/new`  | ✅     | PR001 — criação (ADMIN only)                                                                                     |
| `/dashboard/products/[id]` | ✅     | PR001 — detalhe/edição, mídia, variações, custos & margem                                                        |
| `/dashboard/trends`        | ✅     | PR002 — KPIs, tabela com busca/filtro/ordenação/paginação · filtro Origem (PR002.1)                              |
| `/dashboard/creators`      | ✅     | PR003 — KPIs, tabela com busca/filtros/ordenação/paginação, Kanban do pipeline, descoberta (ADMIN)               |
| `/dashboard/outreach`      | ✅     | PR004 — KPIs do outbox, workbench de geração/agendamento                                                         |
| `/dashboard/connectors`    | ✅     | PR005 — KPIs (Importados/Duplicados/Falhas/Ativos), cards por conector, tabela de conteúdo externo               |
| `/dashboard/matches`       | ✅     | PR005.1 — KPIs (Importados/Automáticos/Pendentes/Confiança média), tabela Vídeo·Produto·Confidence·Origem·Status |
| `/settings`                | ✅     | Profile + integrations status                                                                                    |
| `/api/auth/*`              | ✅     | NextAuth v5 handler (Credentials provider active)                                                                |

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
- `app/dashboard/connectors/actions.ts` → 3 actions (PR005):
  `syncConnectorAction` (executa o job manual `sync-connector`) ·
  `toggleConnectorAction` (ativa/desativa um conector) ·
  `testConnectorAction` (diagnóstico — nunca acessa a rede em PR005). All
  `requireAdmin()` + tenant-scoped repository; `organizationId` is never
  accepted from the client.
- `app/dashboard/matches/actions.ts` → 3 actions (PR005.1):
  `createProductMatch` (vincula conteúdo ⇄ produto manualmente) ·
  `approveMatch` (promove para MANUAL com confiança 1.00) ·
  `removeMatch` (remove o match). All `requireManager()` (ADMIN+MANAGER;
  MEMBER é somente leitura) + tenant-scoped repository; the repository
  refuses content/product ids that do not belong to the caller's tenant.

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

### Connectors RBAC (PR005)

| Ação                      | ADMIN | MANAGER | MEMBER               |
| ------------------------- | ----- | ------- | -------------------- |
| Sincronizar conector      | ✅    | ❌      | ❌                   |
| Ativar/desativar conector | ✅    | ❌      | ❌                   |
| Testar conector           | ✅    | ❌      | ❌                   |
| Visualizar dashboard      | ✅    | ✅      | ✅ (somente leitura) |

> Connectors are **infrastructure**, not content: MANAGER's write powers in
> the CRM (PR003) and outreach (PR004) deliberately do NOT extend here —
> every write action is `requireAdmin()` (pinned by
> `tests/connectors-rbac.test.ts`).

### Matches RBAC (PR005.1)

| Ação          | ADMIN | MANAGER | MEMBER               |
| ------------- | ----- | ------- | -------------------- |
| Criar match   | ✅    | ✅      | ❌                   |
| Aprovar match | ✅    | ✅      | ❌                   |
| Remover match | ✅    | ✅      | ❌                   |
| Visualizar    | ✅    | ✅      | ✅ (somente leitura) |

> Matches are **curatable content**, not infrastructure: MANAGER writes
> here by design (the inverse of the connectors boundary). MEMBER is
> read-only — every write action is `requireManager()` (pinned by
> `tests/matches-rbac.test.ts`).

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

`npm test` (Vitest, `tests/`) — **893 unit tests** (47 files), no database
required:

| File                                     | Covers                                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/rbac.test.ts`                     | `hasRole`, `isAdmin`, `isManager`, `assertRole`, full hierarchy matrix                                                                                                                                                                           |
| `tests/session.test.ts`                  | `getCurrentUser`, `getCurrentOrganization`, `requireUser`, `requireOrganization`, `requireRole`, `requireAdmin`, `requireManager`, no-secret-leak assertion                                                                                      |
| `tests/tenant.test.ts`                   | `tenantWhere`, `scopedWhere`, `assertSameTenant`, cross-tenant isolation (a caller-supplied `organizationId` cannot override the scope)                                                                                                          |
| `tests/password.test.ts`                 | bcrypt digest shape, salting, verification, no plaintext                                                                                                                                                                                         |
| `tests/pricing.test.ts`                  | PR001 — `totalCostCents`, `profitCents`, `marginBps` (rounding, zero price, negative margin), display helpers                                                                                                                                    |
| `tests/slug.test.ts`                     | PR001 — `baseSlug` (accents, fallback, length cap), `resolveUniqueSlug` (`-2`/`-3` collision handling, max length)                                                                                                                               |
| `tests/product-validators.test.ts`       | PR001 — every Zod schema incl. hostile inputs (client-supplied `organizationId` is stripped; hostile sort fields fall back)                                                                                                                      |
| `tests/product-list-where.test.ts`       | PR001 — dashboard filter builder always injects the tenant scope; throws without one                                                                                                                                                             |
| `tests/products-rbac.test.ts`            | PR001 — products RBAC matrix (ADMIN cria/edita/exclui · MANAGER edita · MEMBER leitura)                                                                                                                                                          |
| `tests/media-storage.test.ts`            | PR001 — upload policy (mime allowlist, 10 MB cap) + placeholder provider contract                                                                                                                                                                |
| `tests/trend-scorer.test.ts`             | PR002 — score engine: weights (30/20/15/20/15), normalization to 0–100, clamping, rounding, guard errors                                                                                                                                         |
| `tests/trend-collector.test.ts`          | PR002 — mock collector: exactly 30 valid unique signals, 5 categories, scores 60–98, deterministic + defensive copies (+ PR002.1 `collect()` alias)                                                                                              |
| `tests/trend-validators.test.ts`         | PR002 — Zod schemas (signal/snapshot/list query) incl. hostile inputs + `keywordSlug`/`normalizeKeyword` (accents, fallback, length cap)                                                                                                         |
| `tests/trend-repository.test.ts`         | PR002 — repository against an in-memory fake Prisma: tenant always injected, blank tenant throws before ANY db call, cross-tenant invisibility, filters                                                                                          |
| `tests/trend-scheduler.test.ts`          | PR002 — `collect-daily-trends` job (collect → score → validate → persist → aggregate), failure handling, manual-only contract (+ PR002.1 multi-source)                                                                                           |
| `tests/trend-source.test.ts`             | PR002.1 — `TrendSource` enum ↔ `TREND_SOURCES` sync, labels, MOCK default, Zod source schemas (accept/reject/defaults), URL-state `?source=`                                                                                                     |
| `tests/collector-factory.test.ts`        | PR002.1 — `getCollector()` mapping per source, placeholder collectors throw "Not implemented", MANUAL/unknown throw, singleton cache, no-switch architecture                                                                                     |
| `tests/trends-rbac.test.ts`              | PR002 — trends RBAC matrix (ADMIN coleta/cria · MANAGER visualiza · MEMBER leitura)                                                                                                                                                              |
| `tests/trend-dto.test.ts`                | PR002 — DTO mappers: ISO serialization across the RSC boundary, score computed engine-side                                                                                                                                                       |
| `tests/connector-platform.test.ts`       | PR005 — the four connector enums ↔ their client-safe mirrors ↔ the Zod schemas (23 tests): labels, MOCK default, placeholder list, `isConnectorActive` KPI predicate, type guards                                                                |
| `tests/connector-factory.test.ts`        | PR005 — `getConnector()` mapping per platform, singleton cache, registry helpers, unregistered platform throws `ConnectorNotRegisteredError`, placeholders throw on `fetchContent()` but answer `testConnection()` calmly (18 tests)             |
| `tests/connector-mock.test.ts`           | PR005 — the mock adapter: 36 unique + 4 deliberate duplicates, type distribution, determinism (identical across runs), defensive copies, `limit`/`since`/`type` options, zero network access (17 tests)                                          |
| `tests/connector-repository.test.ts`     | PR005 — repository against an in-memory fake Prisma: tenant always injected, blank tenant throws before ANY db call, cross-tenant invisibility, tenant-scoped dedupe, status lifecycle, counter accumulation, the four KPIs (20 tests)           |
| `tests/connector-sync.test.ts`           | PR005 — the `sync-connector` job: import/dedupe/failure paths, counters, state transitions, placeholder handling (recorded ERROR, never a crash), `AuthorizationError` re-thrown, manual-only contract (22 tests)                                |
| `tests/connector-dto.test.ts`            | PR005 — DTO mappers (ISO serialization, no tenant/raw leak, never-synced platform renders IDLE) + every validator incl. hostile inputs and malformed URL state (28 tests)                                                                        |
| `tests/connectors-rbac.test.ts`          | PR005 — connectors RBAC matrix: every write is ADMIN-only; MANAGER's powers elsewhere do not leak into connector infrastructure (6 tests)                                                                                                        |
| `tests/match-scorer.test.ts`             | PR005.1 — rule weights (40/25/20/15 = 100) + `calculateMatchConfidence`: spec examples (0.98/0.76/0.52), clamping (never above 1, never below 0), 2-decimal rounding, hostile input collapses to 0 (17 tests)                                    |
| `tests/match-matcher.test.ts`            | PR005.1 — matcher engine: each rule fires alone and combined (full 1.00), normalization (accents/case/hyphens), whole-word strictness, derived categories, determinism, unique pairs, confidence-desc order, Prisma-row compatibility (29 tests) |
| `tests/product-match-repository.test.ts` | PR005.1 — repository against an in-memory fake Prisma: tenant always injected, blank tenant throws before ANY db call, cross-tenant invisibility, FK ownership on create, approve→MANUAL+1.00, KPIs (22 tests)                                   |
| `tests/product-match-dto.test.ts`        | PR005.1 — enum↔mirror sync, Zod schemas (confidence 0–1 bounds, rounding, hostile inputs), list-query safe defaults, DTO mappers (ISO dates, status derivation, pending backlog) (32 tests)                                                      |
| `tests/matches-rbac.test.ts`             | PR005.1 — matches RBAC matrix: ADMIN+MANAGER write, MEMBER read-only, every guard maps to `requireManager()`, asymmetric boundary vs connectors pinned (8 tests)                                                                                 |

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
- **Connector real platforms (TikTok · Instagram · Shopee) — PR005 ships
  the architecture only.** The three adapters are placeholders behind
  `getConnector()`; MOCK is the only implemented connector. No API call,
  no SDK, no scraping, no OAuth and **no credential storage** exists —
  `ConnectorStatus` deliberately has no token column. A future PR must add
  a server-only secret _reference_, never a raw secret.
- Cron/scheduler wiring for `collect-daily-trends` / `discover-creators` /
  `sync-connector` — manual trigger only
- Analytics pipeline — `modules/analytics` (PR007)

---

## 11. Changelog

### PR005.1 — Product Match Architecture (2026-09-22) — completed

The layer that relates imported external content (videos/posts) to internal
products — **"este vídeo vende este produto?"**. **Deterministic rules
ONLY**: no OpenAI, no computer vision, no embeddings, no TikTok
integration; every correspondence is decided by four text rules.

**Prisma**

- Enum `MatchSource` (AI · MANUAL · RULE) and model `ProductMatch`
  (`organizationId`/`externalContentId`/`productId` required FKs with
  Cascade · `confidence Float` · `matchedBy MatchSource`), unique
  `(externalContentId, productId)`, tenant + confidence indexes.
- Migration `20260923220000_product_match_architecture` — purely
  ADDITIVE, no existing table touched.

**Matcher Engine** (`modules/campaigns/matching/`)

- `matchProductsToContent(contents, products)` → persistence-ready
  drafts, best confidence first. Rules: **+40** keyword in the title ·
  **+25** category coincidence · **+20** slug in the content text ·
  **+15** partial word (≥ 4 chars).
- `calculateMatchConfidence(points)` normalizes 0–100 → 0.00–1.00
  (rounded to 2 decimals, clamped — **never above 1**).
- Pure functions: no I/O, no clock, no randomness — deterministic output
  pinned by tests. Accepts plain Prisma rows.

**Repository / DTO / actions**

- `product-match.repository.ts` — `createMatch` (FK ownership checked
  before any write) · `listMatches` · `findByContent` · `findByProduct` ·
  `approveMatch` · `deleteMatch` · `kpis`; `organizationId` always first.
- `CreateProductMatchDTO` + Zod (confidence 0–1, rounded; tenant never
  accepted from the client); RSC-serializable item/page/KPI DTOs.
- Server actions `createProductMatch()` · `approveMatch()` ·
  `removeMatch()` — `requireManager()` (MEMBER read-only); approve
  promotes to MANUAL with confidence 1.00.

**Dashboard** `/dashboard/matches` — KPIs (Conteúdos importados · Matches
automáticos · Pendentes · Confiança média) + table Vídeo · Produto ·
Confidence · Origem · Status (sorted by confidence, URL-state search +
pagination, Aprovar/Remover for MANAGER+).

**Seed** — 18 topic-aligned catalog products (idempotent upserts) + **50
matches** through the REAL matcher engine: 20 AI · 20 RULE · 10 MANUAL,
confidence in the 0.55–0.99 band.

**Tests** — 108 new tests across 5 files (**893 total**, all green):
scorer, matcher, repository (+tenant), DTO/validators, RBAC.

**Not performed:** no merge (PR left open for human audit, per the PR000
workflow).

### PR005 — Connector Framework (2026-09-22) — completed

Multi-platform connector architecture for importing external content.
**ARCHITECTURE ONLY — no real API is integrated** (no TikTok API, no
Instagram Graph API, no Shopee, no scraping, no SDK, no OAuth, no
credential storage; zero network calls).

**Modules**

- `modules/connectors/core` — `Connector` interface, `ConnectorFactory`
  (`getConnector`), Zod validators, DTOs, tenant-scoped repository and the
  `sync-connector` service (manual job, no cron).
- `modules/connectors/mock` — `MockConnector`, the only IMPLEMENTED
  adapter: 40 deterministic items (36 unique + 4 deliberate duplicates, so
  the dedupe path and the "Duplicados" KPI have data out of the box).
- `modules/connectors/tiktok` · `instagram` · `shopee` — placeholders that
  throw `ConnectorNotImplementedError` on `fetchContent()` while answering
  `testConnection()` calmly.

**Architecture contracts**

- A platform is resolved **only** through `getConnector(platform)` — no
  `switch` outside the factory (pinned by test). Adding a real adapter is
  a one-line factory registration with **zero caller changes**.
- An adapter may only _describe_ content (`NormalizedContent`); the import
  outcome (IMPORTED / DUPLICATE / FAILED) is decided by the sync service.
- Every item is validated (Zod) **before** any write, so a misbehaving
  adapter produces FAILED rows instead of corrupt content.
- A placeholder sync is a recorded ERROR on `ConnectorStatus`, never a
  crash; a partial failure keeps the connector ACTIVE.
- `AuthorizationError` is re-thrown (401/403), never swallowed as a
  "failed job".

**Prisma**

- Enums `ConnectorPlatform`, `ConnectorState`, `ExternalContentType`,
  `ExternalContentStatus`.
- `ConnectorStatus` — per-tenant per-platform state, enable toggle,
  `lastSyncAt`/`lastError` and the cumulative counters. Unique
  `(organizationId, platform)`. **No credential column, by design.**
- `ExternalContent` — the imported item. Unique
  `(organizationId, platform, externalId)`: the tenant-scoped dedupe key.
- Migration `20260923180000_connector_framework` is purely ADDITIVE — no
  existing table, column or row is touched.

**Dashboard `/dashboard/connectors`**

- KPIs: **Importados · Duplicados · Falhas · Conectores ativos**.
- One card per registered connector (state badge, placeholder badge,
  per-connector counters, last sync, last error) with the ADMIN actions
  Sincronizar · Ativar/Desativar · Testar.
- Table of imported content with busca, filtros (plataforma, status,
  tipo), ordenação e paginação em URL-state; responsivo.

**RBAC** — every write action is `requireAdmin()` (connectors are
infrastructure); MANAGER and MEMBER are read-only.

**Tests** — 135 new tests across 7 files (785 total, all green): enum/mirror
sync, factory mapping and singleton behaviour, mock determinism, repository
tenant isolation, sync orchestration (import/dedupe/failure/placeholder) and
the RBAC matrix.

**Seed** — registers the four connectors (Mock active, the three
placeholders IDLE/disabled) and imports the mock dataset through the same
dedupe rule the sync service uses. Idempotent.

**Not performed:** no merge (PR left open for human audit, per the PR000
workflow).

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
| PR004                              | Outreach AI & Sales Pipeline      | ✅ done |
| PR005                              | Connector Framework               | ✅ done |
| PR005.1                            | Product Match Architecture        | ✅ this |
| PR006                              | Campaign Engine                   | ⏭ next  |
| PR007                              | Messaging & Inbox                 | planned |
| PR008                              | Analytics & Reporting             | planned |
| PR009                              | Billing & Multi-tenancy hardening | planned |
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
| PR004   | Outreach AI & Sales Pipeline      | ✅ done |
| PR005   | Connector Framework               | ✅ done |
| PR005.1 | Product Match Architecture        | ✅ this |
| PR006   | Campaign Engine                   | ⏭ next  |
| PR007   | Messaging & Inbox                 | planned |
| PR008   | Analytics & Reporting             | planned |
| PR009   | Billing & Multi-tenancy hardening | planned |

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

### Next after PR004: PR005 (delivered)

PR005 shipped the Connector Framework — providers stay behind adapters
(`getConnector()`), tenant scope and server-side RBAC are never bypassed and
no real API/credential is wired. See the PR005 changelog entry above.

## PR005 — Connector Framework (2026-09-22)

### Status: implemented (no merge — PR open for human audit)

- **Connectors:** `modules/connectors/{core,mock,tiktok,instagram,shopee}` — `Connector` interface, `ConnectorFactory`, `MockConnector` (implemented) and three placeholders.
- **No real API:** no TikTok/Instagram/Shopee call, no SDK, no scraping, no OAuth, no credential storage — `ConnectorStatus` has no token column by design.
- **Sync service:** `sync-connector` job — fetch → validate (Zod) → dedupe → persist IMPORTED/DUPLICATE/FAILED → update state + counters. Manual execution only, no cron.
- **Dedupe:** tenant-scoped unique `(organizationId, platform, externalId)`; a re-import refreshes the known row instead of duplicating it.
- **Prisma:** `ConnectorPlatform`, `ConnectorState`, `ExternalContentType`, `ExternalContentStatus`, `ConnectorStatus`, `ExternalContent` — all tenant-scoped; migration purely additive.
- **Dashboard:** `/dashboard/connectors` with KPIs Importados · Duplicados · Falhas · Conectores ativos, connector cards and the external-content table (busca/filtros/ordenação/paginação em URL-state).
- **RBAC:** every write is ADMIN-only; MANAGER/MEMBER read-only.
- **Tests:** 135 new tests (785 total, all green).

### PR005 module layout

```text
modules/connectors/
├── core/       connector.interface · connector.factory · connector.validator ·
│               connector.dto · connector.repository · connector.sync
├── mock/       MockConnector (implemented — deterministic dataset)
├── tiktok/     TikTokConnector (placeholder)
├── instagram/  InstagramConnector (placeholder)
└── shopee/     ShopeeConnector (placeholder)
```

### Next: PR006

Campaign Engine may consume `ExternalContent` and the connector KPIs. A real
adapter must plug in behind `getConnector()` with zero caller changes, resolve
its secret through a server-only reference (never a raw token in the database
or the client bundle) and must not bypass tenant scope or server-side RBAC.
