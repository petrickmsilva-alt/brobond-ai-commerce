# PROJECT STATE — Brobond AI Commerce OS

> Living document tracking the architectural state of the platform.
> Updated per PR. Source of truth for "what exists" vs. "what is planned".

**Last updated:** 2026-09-22
**Current PR:** PR000.1 — Architecture Hotfix
**Branch:** `arena/01a0c8bf-brobond-ai-commerce`

---

## 1. Snapshot

| Aspect       | State                                                        |
| ------------ | ------------------------------------------------------------ |
| Stage        | Foundation (pre-feature)                                     |
| Architecture | **Multi-tenant** (Organization = tenant boundary)            |
| Currency     | **BRL** (default across Product, Campaign, Sale)             |
| Auth         | NextAuth v5 (Prisma adapter, JWT) + **initial RBAC (ADMIN)** |
| Database     | PostgreSQL via Prisma (pg driver adapter, Rust-free client)  |
| Migrations   | `20260922000000_init_multitenant` (initial)                  |
| Deploy       | Render Blueprint (`render.yaml`) + GitHub Actions            |
| Build/CI     | ✅ green (install → prisma generate → lint → build)          |

---

## 2. Tech Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
Prisma ORM · PostgreSQL · NextAuth v5 · Zod · React Hook Form · Lucide ·
Docker · ESLint · Prettier · Render.

---

## 3. Multi-Tenancy

`Organization` is the top-level tenant. The following models carry an
`organizationId` foreign key (`onDelete: Cascade`) and are isolated per tenant:

- `User` → `Organization`
- `Product` → `Organization`
- `Creator` → `Organization`
- `Campaign` → `Organization`

`Sale` and `Message` inherit tenant scope transitively through their parent
relations (product/creator/campaign). Promoting them to direct tenant FKs is
tracked for a later PR if cross-entity queries require it.

---

## 4. RBAC (initial)

Roles: `ADMIN` > `MANAGER` > `MEMBER` (ranked in `lib/auth.ts`).

- `hasRole(role, required)` — hierarchical check.
- `isAdmin(role)` — ADMIN check.
- `requireAdmin()` — throws `Forbidden` for non-ADMIN sessions (guard for
  admin-only server actions / route handlers).

Role + `organizationId` are persisted on the JWT (`jwt` callback) and exposed
on the session (`session` callback), so authorization checks avoid a DB hit.

---

## 5. Data Model

| Model                             | Purpose                       | Tenant-scoped     |
| --------------------------------- | ----------------------------- | ----------------- |
| Organization                      | Tenant boundary               | — (is the tenant) |
| User                              | Team members + roles          | ✅ direct FK      |
| Product                           | Catalog (BRL)                 | ✅ direct FK      |
| Creator                           | Creator roster                | ✅ direct FK      |
| Campaign                          | Orchestration (BRL)           | ✅ direct FK      |
| Message                           | Conversations                 | ↳ via relations   |
| Sale                              | Revenue records (BRL)         | ↳ via relations   |
| CampaignProduct                   | M:N join (campaign ⇄ product) | ↳ via campaign    |
| CampaignCreator                   | M:N join (campaign ⇄ creator) | ↳ via campaign    |
| Account/Session/VerificationToken | NextAuth adapter              | —                 |

---

## 6. Routes

| Route         | Status | Notes                         |
| ------------- | ------ | ----------------------------- |
| `/`           | ✅     | Landing                       |
| `/login`      | ✅     | RHF + Zod (providers pending) |
| `/dashboard`  | ✅     | App shell, KPI placeholders   |
| `/settings`   | ✅     | Profile + integrations status |
| `/api/auth/*` | ✅     | NextAuth v5 handler           |

---

## 7. Environment Variables

Active: `NODE_ENV`, `APP_NAME`, `APP_URL`, `DATABASE_URL`, `AUTH_SECRET`,
`AUTH_URL`, `NEXTAUTH_URL`, `AUTH_TRUST_HOST`.

> `APP_URL` was **removed** from `render.yaml` in PR000.1; `NEXTAUTH_URL` was
> **added** as the canonical deployment URL for NextAuth callbacks.

Reserved (NOT implemented): TikTok, OpenAI, Analytics keys.

---

## 8. Not Implemented (interface only)

- TikTok API — `modules/integrations/tiktok` (PR002/PR004)
- AI provider (OpenAI) — `modules/integrations/ai` (PR003)
- Analytics pipeline — `modules/analytics` (PR006)
- No scraping.

---

## 9. Changelog

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

## 10. Roadmap

| PR      | Title                             | Status  |
| ------- | --------------------------------- | ------- |
| PR000   | Bootstrap Foundation              | ✅ done |
| PR000.1 | Architecture Hotfix               | ✅ this |
| PR001   | Products CRUD                     | planned |
| PR002   | Creators & TikTok Link            | planned |
| PR003   | AI Assistant                      | planned |
| PR004   | Campaign Engine                   | planned |
| PR005   | Messaging & Inbox                 | planned |
| PR006   | Analytics & Reporting             | planned |
| PR007   | Billing & Multi-tenancy hardening | planned |
