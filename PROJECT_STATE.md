# PROJECT STATE — Brobond AI Commerce OS

> Living document tracking the architectural state of the platform.
> Updated per PR. Source of truth for "what exists" vs. "what is planned".

**Last updated:** 2026-09-22
**Current PR:** PR001 — Product Intelligence Core
**Status:** completed (awaiting review/merge)
**Branch:** `arena/01a0c921-brobond-ai-commerce`
**Next PR:** PR002 — Creators & TikTok Link

> **Workflow (instituted in PR001):** no more direct merges to `main`.
> Feature branch → Pull Request → human audit → approval → merge → Render deploy.

---

## 1. Snapshot

| Aspect       | State                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Stage        | First feature module shipped (Products)                                                                  |
| Architecture | **Multi-tenant, enforced** (`organizationId` NOT NULL on domain models)                                  |
| Modules      | `modules/commerce/products` — services / repositories / dto / pricing / validators                       |
| Currency     | **BRL** (default across Product, Campaign, Sale) · money = integer cents · margin = basis points         |
| Auth         | NextAuth v5 (Prisma adapter, JWT) + **Credentials provider (email/senha)**                               |
| RBAC         | ADMIN > MANAGER > MEMBER — products: ADMIN cria/edita/exclui · MANAGER edita · MEMBER somente leitura    |
| Database     | PostgreSQL via Prisma (pg driver adapter, Rust-free client)                                              |
| Migrations   | `…_init_multitenant` · `…_require_organization` · `…_product_intelligence_core`                          |
| Tests        | Vitest — 114 unit tests (RBAC, session, tenancy, passwords, pricing, slug, validators, filters, storage) |
| Deploy       | Render Blueprint (`render.yaml`) + GitHub Actions                                                        |
| Build/CI     | ✅ green (ci → validate → generate → lint → typecheck → test → build → format)                           |

---

## 2. Tech Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
Prisma ORM · PostgreSQL · NextAuth v5 · bcryptjs · Zod · React Hook Form ·
Lucide · Vitest · Docker · ESLint · Prettier · Render.

---

## 3. Multi-Tenancy (hardened in PR000.2)

`Organization` is the top-level tenant. The following models carry a
**required** `organizationId` foreign key (`onDelete: Cascade`):

| Model      | Column                  | Relation                |
| ---------- | ----------------------- | ----------------------- |
| `User`     | `organizationId String` | `organization` required |
| `Product`  | `organizationId String` | `organization` required |
| `Creator`  | `organizationId String` | `organization` required |
| `Campaign` | `organizationId String` | `organization` required |

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

| Model                             | Purpose                             | Tenant-scoped     |
| --------------------------------- | ----------------------------------- | ----------------- |
| Organization                      | Tenant boundary                     | — (is the tenant) |
| User                              | Team members + roles                | ✅ required FK    |
| Product                           | Catalog (BRL, stock, cost, margin)  | ✅ required FK    |
| ProductMedia                      | Product images/videos (PR001)       | ✅ required FK    |
| ProductVariant                    | Sellable variations + stock (PR001) | ✅ required FK    |
| ProductCost                       | Cost snapshots → margin (PR001)     | ✅ required FK    |
| ProductMetric                     | Daily performance metrics (PR001)   | ✅ required FK    |
| Creator                           | Creator roster                      | ✅ required FK    |
| Campaign                          | Orchestration (BRL)                 | ✅ required FK    |
| Message                           | Conversations                       | ↳ via relations   |
| Sale                              | Revenue records (BRL)               | ↳ via relations   |
| CampaignProduct                   | M:N join (campaign ⇄ product)       | ↳ via campaign    |
| CampaignCreator                   | M:N join (campaign ⇄ creator)       | ↳ via campaign    |
| Account/Session/VerificationToken | NextAuth adapter                    | —                 |

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

**Upload de imagens — interface preparada:** `services/media-storage.ts`
defines `MediaStorageProvider` (`createUploadTicket`/`remove`), size/type
policy (10 MB, image mime allowlist) and a `not-configured` placeholder.
Media is attached by URL today; a real provider (S3/R2/UploadThing) plugs in
behind `getMediaStorage()` with zero caller changes.

---

## 6. Migrations

| Migration                                  | Purpose                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `20260922000000_init_multitenant`          | Initial schema (nullable `organizationId`)                                                                   |
| `20260922120000_require_organization`      | Promotes `organizationId` to `NOT NULL` on 4 models                                                          |
| `20260922180000_product_intelligence_core` | PR001: 4 new product tables, stock/cost/margin columns, tenant-scoped slug/SKU uniqueness, dashboard indexes |

The PR000.2 migration is **safe and non-inventive**: it never fabricates an
Organization and never guesses an owner. A `DO $$ … $$` guard counts tenant-less
rows in `User`/`Product`/`Creator`/`Campaign` and aborts with an actionable
`RAISE EXCEPTION` listing the offending tables, so an operator assigns the
correct tenant before re-running. On a fresh database the guard is a no-op.

---

## 7. Routes

| Route                      | Status | Notes                                                                                  |
| -------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `/`                        | ✅     | Landing                                                                                |
| `/login`                   | ✅     | RHF + Zod → `loginAction` server action → Credentials                                  |
| `/dashboard`               | ✅     | App shell, KPI placeholders                                                            |
| `/dashboard/products`      | ✅     | PR001 — tabela paginada, busca, filtros (status/margem/preço/estoque), ordenação, KPIs |
| `/dashboard/products/new`  | ✅     | PR001 — criação (ADMIN only)                                                           |
| `/dashboard/products/[id]` | ✅     | PR001 — detalhe/edição, mídia, variações, custos & margem                              |
| `/settings`                | ✅     | Profile + integrations status                                                          |
| `/api/auth/*`              | ✅     | NextAuth v5 handler (Credentials provider active)                                      |

Server actions:

- `app/login/actions.ts` → `loginAction()` (generic error, no leak).
- `app/dashboard/products/actions.ts` → 12 actions (product CRUD, media,
  variants, costs, metrics). Every action resolves the tenant from the session
  (`requireAdmin`/`requireManager`), re-validates with Zod, and returns a
  uniform `ActionResult` (never throws to the client).

### Products RBAC (PR001)

| Ação                              | ADMIN | MANAGER | MEMBER |
| --------------------------------- | ----- | ------- | ------ |
| Criar produto                     | ✅    | ❌      | ❌     |
| Editar (+ mídia/variações/custos) | ✅    | ✅      | ❌     |
| Excluir produto                   | ✅    | ❌      | ❌     |
| Visualizar                        | ✅    | ✅      | ✅     |

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

`npm test` (Vitest, `tests/`) — 114 unit tests, no database required:

| File                               | Covers                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/rbac.test.ts`               | `hasRole`, `isAdmin`, `isManager`, `assertRole`, full hierarchy matrix                                                                                      |
| `tests/session.test.ts`            | `getCurrentUser`, `getCurrentOrganization`, `requireUser`, `requireOrganization`, `requireRole`, `requireAdmin`, `requireManager`, no-secret-leak assertion |
| `tests/tenant.test.ts`             | `tenantWhere`, `scopedWhere`, `assertSameTenant`, cross-tenant isolation (a caller-supplied `organizationId` cannot override the scope)                     |
| `tests/password.test.ts`           | bcrypt digest shape, salting, verification, no plaintext                                                                                                    |
| `tests/pricing.test.ts`            | PR001 — `totalCostCents`, `profitCents`, `marginBps` (rounding, zero price, negative margin), display helpers                                               |
| `tests/slug.test.ts`               | PR001 — `baseSlug` (accents, fallback, length cap), `resolveUniqueSlug` (`-2`/`-3` collision handling, max length)                                          |
| `tests/product-validators.test.ts` | PR001 — every Zod schema incl. hostile inputs (client-supplied `organizationId` is stripped; hostile sort fields fall back)                                 |
| `tests/product-list-where.test.ts` | PR001 — dashboard filter builder always injects the tenant scope; throws without one                                                                        |
| `tests/products-rbac.test.ts`      | PR001 — products RBAC matrix (ADMIN cria/edita/exclui · MANAGER edita · MEMBER leitura)                                                                     |
| `tests/media-storage.test.ts`      | PR001 — upload policy (mime allowlist, 10 MB cap) + placeholder provider contract                                                                           |

---

## 10. Not Implemented (interface only)

- TikTok API / scraping — `modules/integrations/tiktok` (PR002/PR004)
- AI provider (OpenAI) — `modules/integrations/ai` (PR003)
- Creator discovery · Trend Hunter · automated outreach — not started
- Analytics pipeline — `modules/analytics` (PR006)

---

## 11. Changelog

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

| PR      | Title                             | Status  |
| ------- | --------------------------------- | ------- |
| PR000   | Bootstrap Foundation              | ✅ done |
| PR000.1 | Architecture Hotfix               | ✅ done |
| PR000.2 | Tenant & Auth Hardening           | ✅ done |
| PR001   | Product Intelligence Core         | ✅ this |
| PR002   | Creators & TikTok Link            | ⏭ next  |
| PR003   | AI Assistant                      | planned |
| PR004   | Campaign Engine                   | planned |
| PR005   | Messaging & Inbox                 | planned |
| PR006   | Analytics & Reporting             | planned |
| PR007   | Billing & Multi-tenancy hardening | planned |
