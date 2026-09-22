<div align="center">

# ✦ Brobond AI Commerce OS

**The enterprise operating system for creator-driven social commerce.**

Production-ready foundation · Modular architecture · Built to scale.

[![CI](https://github.com/petrickmsilva-alt/brobond-ai-commerce/actions/workflows/ci.yml/badge.svg)](https://github.com/petrickmsilva-alt/brobond-ai-commerce/actions/workflows/ci.yml)

</div>

---

## Overview

Brobond AI Commerce OS is a **multi-tenant** SaaS platform that connects
**products**, **creators**, and **campaigns** into a single operating system for
social commerce. This repository contains the production-ready infrastructure,
architecture, and UI shell that every subsequent feature builds on.

> **Scope.** This foundation ships infrastructure, an enforced multi-tenant data
> model, authentication, RBAC, and prepared interfaces only. TikTok API, scraping,
> OpenAI, creator discovery, trend hunting, automated outreach, and the analytics
> pipeline are **intentionally not implemented** — their contracts are defined so
> future PRs can plug in cleanly.

### Multi-tenancy

Every tenant is an **`Organization`**. It is the top-level boundary and owns all
domain data. `User`, `Product`, `Creator`, and `Campaign` each carry a
**required** `organizationId` foreign key (`onDelete: Cascade`).

> **No domain record can exist without an Organization** — enforced by the
> database (`NOT NULL` + FK), not merely by the application layer.

`Sale` and `Message` inherit tenant scope transitively through their parent
relations. Authorization is tenant-aware: the session JWT carries both the user
`role` and `organizationId`, so RBAC and tenant checks avoid extra database
round-trips.

#### Tenant isolation helpers

Server-side session helpers (`lib/session.ts`, `server-only`):

| Helper                     | Behaviour                                              |
| -------------------------- | ------------------------------------------------------ |
| `getCurrentUser()`         | Current principal or `null` — never throws             |
| `getCurrentOrganization()` | Current `organizationId` or `null` — never throws      |
| `requireUser()`            | Throws `AuthorizationError` (401) when unauthenticated |
| `requireOrganization()`    | Throws 401/403; returns a guaranteed `organizationId`  |

Pure tenant primitives (`lib/tenant.ts`): `assertOrganizationId`, `tenantWhere`,
`scopedWhere`, `assertSameTenant`.

**Every domain service is organization-scoped — no query may run without it:**

```ts
// route handler / server action
const organizationId = await requireOrganization();
const products = await productsService.list(organizationId);

// modules/products/products.service.ts
list(organizationId: string) {
  return prisma.product.findMany({ where: tenantWhere(organizationId) });
}
// → where: { organizationId: currentOrganizationId }
```

`scopedWhere()` applies the tenant clause **last**, so a caller-supplied filter
can never widen or override the isolation boundary. `assertSameTenant()` returns
`null` for a foreign record, so a globally-unique key (`slug`, `handle`) cannot
be used to probe another tenant.

### Authentication

NextAuth v5 with the Prisma adapter, JWT sessions, and a **Credentials
provider** (`email` + `password`).

- **No public sign-up.** Accounts are provisioned out-of-band; `authorize()`
  only authenticates users that already exist and already have a password.
- Passwords are stored **only** as a bcrypt digest (cost 12) in
  `User.passwordHash` — plaintext is never persisted, logged or returned.
- Sign-in runs through the `loginAction` server action, which returns a single
  generic error so "unknown email" and "wrong password" are indistinguishable.

### RBAC

Roles are hierarchical — `ADMIN` > `MANAGER` > `MEMBER`.

Pure logic in `lib/rbac.ts` (no NextAuth/Prisma dependency, unit-tested):

- `hasRole(role, required)` — hierarchical privilege check
- `isAdmin(role)` / `isManager(role)` — convenience checks
- `assertRole(role, required)` — throws `AuthorizationError` (`status` 401/403)

Session guards in `lib/session.ts`:

- `requireRole(required)` — asserts role **and** tenant; returns a user with a
  non-nullable `organizationId`
- `requireAdmin()` — ADMIN only
- `requireManager()` — MANAGER or above

### Security boundary

`AUTH_SECRET`, `DATABASE_URL` and `passwordHash` are **server-only** and are
never sent to a client component. `authorize()` strips `passwordHash` before
returning, so it never reaches the JWT or the session; `CurrentUser` exposes
only `id · email · name · image · role · organizationId`.

---

## Tech Stack

| Layer          | Technology                                     |
| -------------- | ---------------------------------------------- |
| Framework      | Next.js 15 (App Router) · React 19             |
| Language       | TypeScript (strict)                            |
| Styling        | Tailwind CSS v4 · Inter · dark premium theme   |
| ORM / Database | Prisma ORM · PostgreSQL                        |
| Auth           | NextAuth v5 (Prisma adapter, JWT, Credentials) |
| Passwords      | bcryptjs (cost 12, hash-only)                  |
| Forms          | React Hook Form · Zod                          |
| Icons          | Lucide                                         |
| Testing        | Vitest (unit)                                  |
| Tooling        | ESLint · Prettier · Docker · GitHub Actions    |
| Deploy         | Render (Blueprint)                             |

---

## Architecture

The codebase follows a clean, layered, domain-driven structure. **UI never talks to
the database directly** — it goes through the module layer, which depends on `lib/`.

```
┌────────────────────────────────────────────────────────────┐
│  app/            Routes, layouts, route handlers (App Router)│
├────────────────────────────────────────────────────────────┤
│  components/     Presentational + layout UI (client/server)  │
├────────────────────────────────────────────────────────────┤
│  modules/        Domain logic & services (server-only)       │
│                  products · creators · campaigns · sales     │
│                  messaging · analytics* · integrations*      │
├────────────────────────────────────────────────────────────┤
│  lib/            Cross-cutting infra: prisma, auth, env,     │
│                  utils, navigation, validations              │
├────────────────────────────────────────────────────────────┤
│  prisma/         Schema, migrations, seed                    │
└────────────────────────────────────────────────────────────┘
        * interface only in PR000 (prepared, not implemented)
```

### Project structure

```
brobond-ai-commerce/
├── app/
│   ├── api/auth/[...nextauth]/route.ts   NextAuth v5 handler
│   ├── dashboard/                        Dashboard (app shell)
│   ├── login/                            Auth screen (RHF + Zod) + actions.ts
│   ├── settings/                         Account & integrations
│   ├── layout.tsx                        Root layout (Inter, metadata)
│   ├── page.tsx                          Landing page
│   └── not-found.tsx
├── components/
│   ├── auth/         login-form
│   ├── dashboard/    kpi-card
│   ├── layout/       app-shell · sidebar · header · page-header
│   └── ui/           button · card · badge · input
├── modules/
│   ├── products/     products.service.ts
│   ├── creators/     creators.service.ts
│   ├── campaigns/    campaigns.service.ts
│   ├── sales/        sales.service.ts
│   ├── analytics/    analytics.interface.ts        (PR006)
│   └── integrations/
│       ├── tiktok/   tiktok.interface.ts           (PR002/PR004)
│       └── ai/       ai.interface.ts               (PR003)
├── lib/              prisma · auth · session · rbac · tenant · password
│   │                 env · utils · navigation · constants
│   └── validations/  auth
├── hooks/            use-sidebar · use-media-query
├── types/            index · next-auth.d.ts
├── tests/            rbac · session · tenant · password (Vitest)
├── prisma/           schema.prisma · migrations/ · seed.ts
├── public/           favicon.svg
├── styles/           globals.css (Tailwind v4 theme)
├── Dockerfile · docker-compose.yml · render.yaml
├── .env.example · .github/workflows/{ci,deploy}.yml
```

### Data model

Tenant model + six core models plus join tables and NextAuth adapter tables.
Monetary values default to **BRL** (stored in cents).

- **Organization** — tenant boundary; owns users, products, creators, campaigns.
- **User** — team members with roles (`ADMIN`, `MANAGER`, `MEMBER`); tenant **required**.
- **Product** — catalog items with pricing (BRL) and status; tenant **required**.
- **Creator** — creator roster (`externalId` reserved for TikTok); tenant **required**.
- **Campaign** — orchestration linking products ⇄ creators (M:N); tenant **required**.
- **Message** — conversations across channels (system/email/DM/SMS).
- **Sale** — revenue records (BRL) tied to product/creator/campaign.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- Docker (for local PostgreSQL) — or any PostgreSQL 14+ instance

### Installation

```bash
# 1. Install dependencies
npm ci

# 2. Configure environment
cp .env.example .env
# → set AUTH_SECRET (openssl rand -base64 32) and DATABASE_URL

# 3. Start PostgreSQL (via docker-compose)
docker compose up -d db

# 4. Generate the Prisma client & apply the schema
npm run prisma:generate
npm run prisma:migrate   # applies the multi-tenant migrations

# 5. (Optional) Seed the tenant + the first ADMIN account
SEED_ADMIN_PASSWORD='choose-a-strong-password' npm run db:seed

# 6. Run the dev server
npm run dev
```

App runs at **http://localhost:3000**.

### Environment variables

The runtime reads exactly four variables:

| Variable          | Required | Purpose                                        |
| ----------------- | -------- | ---------------------------------------------- |
| `AUTH_SECRET`     | yes      | NextAuth v5 JWT/session signing secret         |
| `NEXTAUTH_URL`    | prod     | Canonical URL for NextAuth callbacks/redirects |
| `DATABASE_URL`    | yes      | PostgreSQL connection string (Prisma)          |
| `AUTH_TRUST_HOST` | no       | Trust the proxy `Host` header (Render/Docker)  |

`APP_URL` and `AUTH_URL` were removed — neither was read by the runtime.
`AUTH_SECRET` and `DATABASE_URL` are **server-only**; this project defines no
`NEXT_PUBLIC_` variable.

### First login

There is **no public sign-up**. The seed is the bootstrap path for the first
`ADMIN` of the `brobond` Organization:

```bash
SEED_ADMIN_EMAIL=admin@brobond.ai \
SEED_ADMIN_PASSWORD='choose-a-strong-password' \
npm run db:seed
```

Only the bcrypt digest is stored. If `SEED_ADMIN_PASSWORD` is omitted the admin
is created **without** a password (credentials login disabled) — the seed never
invents one. Then sign in at `/login` with that email and password.

### Tests

```bash
npm test          # Vitest — RBAC, session guards, tenant isolation, passwords
```

No database or network is required; the session layer is mocked.

### Useful scripts

| Script                   | Description                          |
| ------------------------ | ------------------------------------ |
| `npm run dev`            | Start the Next.js dev server         |
| `npm run build`          | `prisma generate` + production build |
| `npm run start`          | Run the production server            |
| `npm run lint`           | ESLint                               |
| `npm run format`         | Prettier (write)                     |
| `npm run typecheck`      | TypeScript, no emit                  |
| `npm test`               | Vitest unit tests (no DB required)   |
| `npm run format:check`   | Prettier (check only)                |
| `npm run prisma:migrate` | Create/apply a dev migration         |
| `npm run prisma:studio`  | Open Prisma Studio                   |
| `npm run db:seed`        | Seed demo data                       |

### Run the full stack with Docker

```bash
docker compose up --build
```

This builds the app image (multi-stage, Next.js standalone) and starts it alongside
PostgreSQL.

---

## Deployment (Render)

Deployment is defined as code in [`render.yaml`](./render.yaml) (a Render Blueprint).

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and point it at the repo.
3. Render provisions:
   - a managed **PostgreSQL** database (`brobond-db`), and
   - a Dockerized **web service** (`brobond-ai-commerce`).
4. `DATABASE_URL` is injected from the database; `AUTH_SECRET` is auto-generated.
   Set `NEXTAUTH_URL` to your service URL (e.g. `https://brobond-ai-commerce.onrender.com`).
5. `preDeployCommand` runs `prisma migrate deploy` before each release.

### CI/CD

| Trigger              | Workflow                       | Actions                                                                                              |
| -------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Open / update PR** | `.github/workflows/ci.yml`     | `npm ci` → `prisma validate` → `generate` → `lint` → `typecheck` → `test` → `build` → `format:check` |
| **Merge to `main`**  | `.github/workflows/deploy.yml` | Trigger Render deploy (hook) — Blueprint auto-deploys                                                |

> With `autoDeploy: true` in the Blueprint, Render redeploys on every push to `main`.
> The deploy workflow additionally supports an explicit `RENDER_DEPLOY_HOOK_URL`
> repository secret for manual/controlled triggers.

---

## Module map

| Module                        | Responsibility          | Status                          |
| ----------------------------- | ----------------------- | ------------------------------- |
| `modules/products`            | Catalog data access     | ✅ Tenant-scoped service        |
| `modules/creators`            | Creator roster          | ✅ Tenant-scoped service        |
| `modules/campaigns`           | Campaign orchestration  | ✅ Tenant-scoped service        |
| `modules/sales`               | Revenue records         | ✅ Tenant-scoped service        |
| `modules/analytics`           | Metrics & reporting     | 🧩 Interface only (PR006)       |
| `modules/integrations/tiktok` | TikTok API / OAuth      | 🧩 Interface only (PR002/PR004) |
| `modules/integrations/ai`     | AI provider (OpenAI, …) | 🧩 Interface only (PR003)       |

---

## Roadmap

| PR          | Title                   | Scope                                                               |
| ----------- | ----------------------- | ------------------------------------------------------------------- |
| **PR000**   | Bootstrap Foundation    | Infra, architecture, dark UI shell, Prisma schema, Docker, CI/CD ✅ |
| **PR000.1** | Architecture Hotfix     | BRL currency, `Organization` tenant model, initial RBAC ✅          |
| **PR000.2** | Tenant & Auth Hardening | Required tenancy, credentials auth, RBAC guards, tests ✅           |
| **PR001**   | Products CRUD           | Full product management (create/edit/list), server actions, tables  |
| **PR002**   | Creators & TikTok Link  | Creator CRUD + TikTok OAuth & profile sync (implements interface)   |
| **PR003**   | AI Assistant            | OpenAI provider implementation, content & outreach generation       |
| **PR004**   | Campaign Engine         | Campaign builder, product/creator assignment, scheduling            |
| **PR005**   | Messaging & Inbox       | Conversations, notifications, multi-channel delivery                |
| **PR006**   | Analytics & Reporting   | Metrics pipeline, dashboards, revenue attribution                   |
| **PR007**   | Billing & Multi-tenancy | Subscriptions, workspaces, roles & permissions hardening            |

---

## License

Proprietary © Brobond. All rights reserved.
