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
> OpenAI, real social APIs, automated outreach, and the analytics pipeline are
> **intentionally not implemented** — their contracts are defined so future PRs
> can plug in cleanly. The **Trend Hunter** (PR002) and the **Creator Discovery
> Engine** (PR003) run entirely on **mock data**: no TikTok API, no scraping,
> no OpenAI, no browser automation. Since **PR002.1** / **PR003** both are
> **multi-source**: every snapshot/profile records its origin
> (`TrendSource` / `CreatorSource`) and real sources plug in behind their
> collector factories.

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
const products = await productService.page(organizationId, query);

// modules/commerce/products/repositories/product.repository.ts
count(organizationId: string) {
  return prisma.product.count({ where: tenantWhere(organizationId) });
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
│   ├── creators/     toolbar · table · pagination · kanban · forms · badges (PR003)
│   ├── dashboard/    kpi-card
│   ├── layout/       app-shell · sidebar · header · page-header
│   └── ui/           button · card · badge · input · select · table
├── modules/
│   ├── commerce/    products/ (PR001)
│   ├── trends/      hunter (collectors · factory · scorer · scheduler) · repositories · dto · validators · interfaces (PR002/PR002.1)
│   ├── creators/     discovery (collectors · factory · scorer · scheduler) · crm (repositories · dto · validators) · interfaces (PR003)
│   ├── campaigns/    campaigns.service.ts · matching (matcher · scorer · match-source) · repositories · dto · validators (PR005.1)
│   ├── sales/        sales.service.ts
│   ├── analytics/    analytics.interface.ts        (PR007)
│   └── integrations/
│       ├── tiktok/   tiktok.interface.ts           (PR004/PR005)
│       └── ai/       ai.interface.ts               (PR004)
├── lib/              prisma · auth · session · rbac · tenant · password
│   │                 env · utils · navigation · constants
│   └── validations/  auth
├── hooks/            use-sidebar · use-media-query
├── types/            index · next-auth.d.ts
├── tests/            rbac · session · tenant · password · trends · creators (Vitest)
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
- **TrendSnapshot / TrendKeyword / TrendCategory** — Trend Hunter data (PR002 · multi-source PR002.1); tenant **required**.
- **CreatorProfile** — creator CRM: source, niche, followers, engagement, 0–100 score, pipeline status (PR003); tenant **required**.
- **CreatorMetric / CreatorTag** — daily snapshots and labels per creator (PR003); tenant **required**.
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

Core runtime variables:

| Variable          | Required | Purpose                                                                                              |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`     | yes      | NextAuth v5 JWT/session signing secret                                                               |
| `NEXTAUTH_URL`    | prod     | Canonical URL for NextAuth callbacks/redirects                                                       |
| `DATABASE_URL`    | yes      | PostgreSQL connection string (Prisma)                                                                |
| `AUTH_TRUST_HOST` | no       | Set to `false` to stop trusting the proxy's forwarded host; trusted by default (Render/Docker)       |
| `APP_URL`         | no       | PR010.3 — public base URL for links handed to users (invitation links); falls back to `NEXTAUTH_URL` |

Optional Google SSO (PR010.3 §5/§12) — set **one complete pair**, never a mix:

| Variable               | Purpose                       |
| ---------------------- | ----------------------------- |
| `AUTH_GOOGLE_ID`       | Google OAuth client id        |
| `AUTH_GOOGLE_SECRET`   | Google OAuth secret           |
| `GOOGLE_CLIENT_ID`     | alias of `AUTH_GOOGLE_ID`     |
| `GOOGLE_CLIENT_SECRET` | alias of `AUTH_GOOGLE_SECRET` |

When a complete pair is present the "Continuar com Google" button appears on
`/login` and the provider is registered; otherwise the button is hidden
entirely (never rendered disabled).

`AUTH_SECRET`, `DATABASE_URL` and the Google credentials are **server-only**;
this project defines no `NEXT_PUBLIC_` variable. (`APP_URL` was removed in
PR000.2 because nothing read it, and reintroduced by PR010.3 with a narrower
mandate — human-facing links only.)

### First login

Since PR010.4 the primary path is **self sign-up**: open `/signup`, fill in
nome, empresa, WhatsApp, email and a password, and the app provisions an
`Organization`, its first `ADMIN` `User`, the workspace defaults
(BRL · pt-BR · America/Sao_Paulo) and an initial set of message templates in a
single transaction — then signs you in and drops you on `/dashboard` with the
onboarding checklist. Signing in with Google for the first time does the same
thing, so no invitation is required to get started.

The seed remains available as a scripted bootstrap for the demo `brobond`
Organization:

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
npm test          # Vitest — 2,632 unit tests
```

No database or network is required; the session layer is mocked and the trend
and creator repositories run against in-memory fake Prisma clients.

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
   - a native Node **web service** (`brobond-ai-commerce`).
4. `DATABASE_URL` is injected from the database; `AUTH_SECRET` is auto-generated.
   Set the required `NEXTAUTH_URL` to your service URL (e.g. `https://brobond-ai-commerce.onrender.com`).
5. `buildCommand` runs the locked install, Prisma generation and Next.js build.
6. `prisma migrate deploy` runs **twice, by design**: once as
   `preDeployCommand` (the right place for it — once per release) and again at
   the head of `startCommand`. `preDeployCommand` is a paid-plan feature and is
   silently ignored on plans that do not have it, which is exactly how a
   deployment can end up serving an application whose database has no schema at
   all (`relation "_prisma_migrations" does not exist`). `migrate deploy` is
   idempotent, so the second run is a no-op once the schema is current.
   The Docker image gets the same guarantee from
   [`scripts/docker-entrypoint.sh`](./scripts/docker-entrypoint.sh); set
   `RUN_MIGRATIONS=false` to opt a container out when a separate release job
   owns migrations.
7. Startup blocks until Prisma, the required migration and schema pass; Render
   probes `/api/health/database` before routing traffic.
8. `AUTH_TRUST_HOST` stays in the blueprint, but host trust no longer depends on
   it: `lib/auth-trust-host.ts` trusts the proxy's forwarded host by default, so
   losing that variable can no longer take sign-in down with
   `UntrustedHost: Host must be trusted`. Set `AUTH_TRUST_HOST=false` to opt out.

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

| Module                        | Responsibility                                                                | Status                          |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| `modules/commerce/products`   | Product Intelligence Core (services/repositories/dto/pricing/validators)      | ✅ PR001                        |
| `modules/creators`            | Creator Discovery Engine + CRM (discovery/crm/interfaces)                     | ✅ PR003                        |
| `modules/campaigns`           | Campaign orchestration + Product Match (matching/repositories/dto/validators) | ✅ PR005.1                      |
| `modules/sales`               | Revenue records                                                               | ✅ Tenant-scoped service        |
| `modules/analytics`           | Metrics & reporting                                                           | 🧩 Interface only (PR006)       |
| `modules/integrations/tiktok` | TikTok API / OAuth                                                            | 🧩 Interface only (PR004/PR005) |
| `modules/integrations/ai`     | AI provider (OpenAI, …)                                                       | 🧩 Interface only (PR004)       |

---

## Trend Hunter AI (PR002 · PR002.1)

The first **Commercial Intelligence** module: it stores, classifies and
prioritizes product trends per tenant (`modules/trends`). PR002 shipped it
**entirely on mock data** — no TikTok API, no scraping, no OpenAI, no
Selenium/Playwright/Puppeteer. **PR002.1** introduced the **multi-source
data architecture**: every snapshot records its origin and real sources
plug in behind the collector factory — still without a single network call.

### Data Sources (PR002.1)

Cada snapshot carrega a sua origem (`TrendSnapshot.source`, enum
`TrendSource` do Prisma) e a coleta é resolvida **exclusivamente** pela
factory `getCollector(source)` — nunca por um `switch` fora dela
(garantido por teste).

| Source      | Collector            | Status                             |
| ----------- | -------------------- | ---------------------------------- |
| `MOCK`      | `MockCollector`      | ✅ implementado (30 sinais/dia)    |
| `TIKTOK`    | `TikTokCollector`    | 🧩 placeholder (`Not implemented`) |
| `SHOPEE`    | `ShopeeCollector`    | 🧩 placeholder (`Not implemented`) |
| `INSTAGRAM` | `InstagramCollector` | 🧩 placeholder (`Not implemented`) |
| `MANUAL`    | — (sem collector)    | ✅ formulário do dashboard         |

```ts
// modules/trends/hunter/collector.factory.ts — o ÚNICO ponto de resolução
const collector = getCollector(TrendSource.MOCK); // ou TIKTOK, SHOPEE, INSTAGRAM
const candidates = await collector.collect(); // Promise<TrendCandidate[]>

// scheduler parametrizado por origem (default: MOCK — comportamento inalterado)
const job = createCollectDailyTrendsJob({ source: TrendSource.MOCK });
```

- **Retrocompatível**: `source` tem `@default(MOCK)` — nenhum dado existente é
  alterado; o `collectDailyTrends()` do PR002 segue disponível como alias.
- **Interface plugável**: `TrendCollector { source; collect() }` retorna
  `TrendCandidate[]` (keyword · category · views · likes · shares · margin ·
  saturation).
- **Dashboard**: filtro **Origem** (Todos · Mock · TikTok · Shopee · Instagram ·
  Manual) via URL-state (`?source=`), sem alterar telas existentes.

### Arquitetura

```
modules/trends/
├── hunter/
│   ├── collectors/      Um TrendCollector por TrendSource (PR002.1)
│   │   ├── MockCollector.ts        MOCK — 30 tendências/dia · 5 categorias ·
│   │   │                           determinístico (implementado)
│   │   ├── TikTokCollector.ts      TIKTOK — placeholder (Not implemented)
│   │   ├── ShopeeCollector.ts      SHOPEE — placeholder (Not implemented)
│   │   └── InstagramCollector.ts   INSTAGRAM — placeholder (Not implemented)
│   ├── collector.factory.ts  getCollector(source) — o ÚNICO ponto onde uma
│   │                         origem resolve para o seu collector (PR002.1)
│   ├── collector.ts     Fachada retrocompatível do PR002 (re-exports)
│   ├── scorer.ts        Score Engine — puro: normaliza tudo para 0–100 e
│   │                    pondera Views 30% · Likes 20% · Shares 15% ·
│   │                    Margin 20% · Low Saturation 15% → inteiro 0–100
│   └── scheduler.ts     SchedulerJob interface + job collect-daily-trends
│                        (manual — NÃO há cron) parametrizado por TrendSource
├── repositories/
│   └── trend.repository.ts   createSnapshot · listSnapshots (+ filtro source)
│                             · topTrends · findKeywords (+ upserts/stats) —
│                             organizationId é SEMPRE o 1º argumento
├── dto/
│   └── create-trend.dto.ts   CreateTrendDTO + shapes serializáveis (RSC)
├── validators/
│   └── trend.validator.ts    Zod (signal/snapshot/list query) + slug de
│                             keyword ("Camisa Masculina" → camisa-masculina)
└── interfaces/
    └── trend.interface.ts    TrendSignal · TrendCollector · TREND_CATEGORIES
```

Prisma models (migrations `20260922230000_trend_hunter_ai` ·
`20260923050000_trend_source`): `TrendSnapshot` (com `source TrendSource
@default(MOCK)` — PR002.1), `TrendKeyword`, `TrendCategory` — all with
required `organizationId`, `createdAt`/`updatedAt` and tenant-scoped
uniqueness where applicable.

### Fluxo

```
ADMIN clica em "Executar coleta" (ou cria uma tendência manual)
        │
        ▼
collectDailyTrendsAction  ──requireAdmin()──▶  tenant garantido da sessão
        │
        ▼
SchedulerJob collect-daily-trends (source: TrendSource — default MOCK)
        │
        ├─▶ getCollector(source).collect()   TrendCandidate[] (fonte plugável)
        ├─▶ scorer.calculateTrendScore()     score 0–100 por tendência
        ├─▶ Zod createTrendSchema.parse()    validação antes de persistir
        ├─▶ repository.createSnapshot()      1 snapshot por tendência
        ├─▶ repository.upsertKeyword()       frequência por keyword (+tenant)
        └─▶ repository.upsertCategory()      score médio por categoria
        │
        ▼
/dashboard/trends — KPIs (Maior Score · Keywords · Categorias · Última Coleta)
                   tabela com busca, filtro por categoria e por origem
                   (PR002.1), ordenação e paginação (URL-state), responsiva
```

RBAC: **ADMIN** executa coleta e cria snapshots · **MANAGER** visualiza ·
**MEMBER** somente leitura. O score é **sempre calculado no servidor**.

---

## Creator Discovery Engine (PR003)

The **intelligent creator CRM**, prepared for TikTok, Instagram and Shopee —
**multi-source, mock data only** (no external API is implemented in PR003, by
design). Pipeline: discovery → score → CRM → dashboard.

### Score Engine

`calculateCreatorScore()` (`modules/creators/discovery/scorer.ts`, pure) —
components normalized to 0–100 then weighted, integer result 0–100:

| Componente  | Peso | Normalização                   |
| ----------- | ---: | ------------------------------ |
| Engagement  |  30% | taxa vs teto de 15%            |
| Frequency   |  25% | posts/semana vs teto de 7      |
| Niche Match |  20% | nicho exato = 100              |
| Growth      |  15% | crescimento 30d vs teto de 20% |
| Quality     |  10% | 0–100 (clamp)                  |

### Data Sources (PR003)

Cada profile carrega a sua origem (`CreatorProfile.source`, enum
`CreatorSource` do Prisma) e a descoberta é resolvida **exclusivamente** pela
factory `getCreatorCollector(source)` — nunca por um `switch` fora dela
(garantido por teste).

| Source      | Collector                   | Status                             |
| ----------- | --------------------------- | ---------------------------------- |
| `MOCK`      | `MockCreatorCollector`      | ✅ implementado (100 creators)     |
| `TIKTOK`    | `TikTokCreatorCollector`    | 🧩 placeholder (`Not implemented`) |
| `INSTAGRAM` | `InstagramCreatorCollector` | 🧩 placeholder (`Not implemented`) |
| `SHOPEE`    | `ShopeeCreatorCollector`    | 🧩 placeholder (`Not implemented`) |
| `MANUAL`    | — (sem collector)           | ✅ formulário do CRM               |

### CRM Pipeline

```
NEW → QUALIFIED → CONTACTED → NEGOTIATING → ACTIVE     (ARCHIVED)
```

`CREATOR_STATUS_TRANSITIONS` + `canTransitionCreatorStatus()` são a fonte
única da verdade: um passo à frente, um passo atrás, arquivo de qualquer
estágio e reativação apenas para NEW. Transições ilegais (ex.: NEW → ACTIVE)
são rejeitadas **antes** de qualquer write, na server action.

```ts
// modules/creators/crm/repositories/creator-profile.repository.ts
const repository = createCreatorRepository(prisma);

repository.listCreators(organizationId, { page: 1, sort: "creatorScore" });
repository.topCreators(organizationId, { limit: 10, minScore: 80 });
repository.changeStatus(organizationId, creatorId, "QUALIFIED");
// organizationId é SEMPRE o 1º argumento — nenhuma query roda sem tenant.
```

### Dashboard

```
/dashboard/creators — KPIs (Creators · Score Médio · Premium · Contatados)
                     tabela (Avatar · Creator · Nicho · Seguidores · Score ·
                     Status) com busca, filtros (nicho/status/origem),
                     ordenação e paginação (URL-state)
                     Kanban do pipeline (6 colunas, movimentação MANAGER+)
                     descoberta manual (ADMIN) · cadastro manual (MANAGER+)
```

RBAC: **ADMIN** executa a descoberta e gerencia o CRM · **MANAGER** cria
profiles e move o pipeline · **MEMBER** somente leitura. O score é **sempre
calculado no servidor** — nunca confiado do cliente. Re-imports da descoberta
**nunca sobrescrevem o status do CRM**.

### Seed

100 mock creators com distribuição mandatória — Moda 35 · Casual 20 ·
Street 20 · Fitness 15 · Executivo 10, seguidores de 5 mil a 2 milhões —
gerados pelo pipeline real (coletor → score engine), com o pipeline
distribuído entre os seis statuses, tags e 7 dias de métricas para o top 10.

### Próximo PR

**PR004 — AI Assistant**: implementar o provider de IA (OpenAI) atrás de
`modules/integrations/ai`. As fontes reais de creators (TikTok, Instagram,
Shopee) chegam em PRs futuros — basta preencher o placeholder correspondente
(o `TikTokCreatorCollector` já lança `Not implemented` e o
`getCreatorCollector(CreatorSource.TIKTOK)` já o resolve). Nenhum consumidor
muda: o contrato (`collect()` → `CreatorCandidate[]`), a stamp de `source` e
o dashboard já estão prontos e testados.

---

## Roadmap

| PR          | Title                        | Scope                                                                        |
| ----------- | ---------------------------- | ---------------------------------------------------------------------------- |
| **PR000**   | Bootstrap Foundation         | Infra, architecture, dark UI shell, Prisma schema, Docker, CI/CD ✅          |
| **PR000.1** | Architecture Hotfix          | BRL currency, `Organization` tenant model, initial RBAC ✅                   |
| **PR000.2** | Tenant & Auth Hardening      | Required tenancy, credentials auth, RBAC guards, tests ✅                    |
| **PR001**   | Products CRUD                | Full product management (create/edit/list), server actions, tables ✅        |
| **PR002**   | Trend Hunter AI              | Trend collection (mock), score engine, scheduler, dashboard ✅               |
| **PR002.1** | Multi-Source Data Arch.      | TrendSource enum, collector factory, origem no dashboard ✅                  |
| **PR003**   | Creator Discovery Engine     | Creator CRM multi-source (mock), score engine, pipeline Kanban, dashboard ✅ |
| **PR004**   | Outreach AI & Sales Pipeline | Deterministic outreach pipeline, outbox, templates (no OpenAI) ✅            |
| **PR005**   | Connector Framework          | Multi-platform content ingestion architecture (mock-only) ✅                 |
| **PR005.1** | Product Match Architecture   | Deterministic content ⇄ product matching engine ✅                           |
| **PR006**   | Messaging & Inbox            | Conversations, notifications, multi-channel delivery                         |
| **PR007**   | Analytics & Reporting        | Metrics pipeline, dashboards, revenue attribution                            |
| **PR008**   | Billing & Multi-tenancy      | Subscriptions, workspaces, roles & permissions hardening                     |

---

## License

Proprietary © Brobond. All rights reserved.

## Outreach AI (PR004)

PR004 adds a deterministic, tenant-scoped sales-outreach pipeline. It does **not**
integrate WhatsApp, TikTok or Instagram, does not send real messages, and does
not use OpenAI. Text generation is entirely based on reviewed templates.

### Architecture

```text
modules/outreach/
├── prompts/       template catalog, safe variable parser and generator
├── queue/         tenant-scoped outbox repository and due-message scheduler
├── crm/           first contact / +3 / +7 / +15 follow-up cadence
├── dto/           server boundary data contracts
├── validators/    Zod validation and variable allowlist
└── interfaces/    client-safe statuses and Prompt Engine contracts
```

Prisma persists `MessageTemplate`, `OutreachMessage` and `FollowUpSequence`.
`organizationId` is mandatory and indexed on every aggregate root. The outbox
scheduler only promotes due `SCHEDULED` records to `READY`; it never transmits
or automatically marks a record `SENT`.

### Flow

1. ADMIN seeds or creates a validated template using the five supported tokens.
2. MANAGER chooses creator, product, campaign and template.
3. `generateOutreachMessage()` replaces `creatorName`, `niche`, `productName`,
   `campaignName` and `trendKeyword`, then stores a `DRAFT`.
4. The server-action editor offers live preview, character count and deterministic
   regeneration. A MANAGER can schedule; an ADMIN can cancel.
5. MEMBER has read-only dashboard access. Every query is tenant-scoped.

### Roadmap PR005

PR005 may add delivery-provider adapters, campaign automation, audit trails and
observability for `READY` records. Real channels and AI providers must remain
opt-in adapters with consent, rate limiting and tenant isolation; none are part
of PR004.

---

## Product Matching Engine (PR005.1)

PR005.1 adds the layer that relates imported external content (videos and
posts from the Connector Framework) to the internal product catalog — the
answer to **"este vídeo vende este produto?"**.

It is **deterministic by rules only**: no OpenAI, no computer vision, no
embeddings and no TikTok integration. Every correspondence is decided by
four text rules and normalized to a `0.00–1.00` confidence that is never
above `1`.

### Flow

```text
ExternalContent          (imported by the Connector Framework, PR005)
        ↓
      Matcher            (modules/campaigns/matching/matcher.ts — rules)
        ↓
   ProductMatch          (persisted with confidence + MatchSource)
        ↓
  Campaign Engine        (PR006 — consumes approved matches)
```

### Rules

| Rule                                 | Points |
| ------------------------------------ | -----: |
| Product keyword in the content title |    +40 |
| Category coincidence                 |    +25 |
| Product slug in the content text     |    +20 |
| Partial word (≥ 4 chars)             |    +15 |

The accumulated points (0–100) are normalized by
`calculateMatchConfidence()` (`matching/scorer.ts`) into a two-decimal
float (`0.98`, `0.76`, `0.52`…), clamped to the `0.00–1.00` range.

### Architecture

```text
modules/campaigns/
├── matching/       matcher.ts (rules engine) · scorer.ts (confidence)
│                   match-source.ts (client-safe enum mirrors + status)
├── repositories/   product-match.repository.ts — organizationId is
│                   ALWAYS the first argument
├── dto/            CreateProductMatchDTO + serializable RSC shapes
└── validators/     Zod schemas (create / approve / remove / list query)
```

Prisma persists `ProductMatch` (`MatchSource` enum: AI · MANUAL · RULE).
`(externalContentId, productId)` is unique — the same video may match
several products and vice-versa, but never the same pair twice. Deleting
either endpoint deletes the match (Cascade).

### Review lifecycle

1. The rules engine stamps automatic matches as `RULE` (AI is reserved
   for a future provider — no AI call exists today).
2. `MANUAL` matches are created or approved by a human — a MANUAL match
   is, by definition, **Aprovado**; AI/RULE matches are **Pendente**.
3. `approveMatch()` promotes a pending match to `MANUAL` with confidence
   `1.00` — the human word is definitive.

### Dashboard `/dashboard/matches`

KPIs: **Conteúdos importados · Matches automáticos · Pendentes
(conteúdos ainda sem nenhum match) · Confiança média**. Table: **Vídeo ·
Produto · Confidence · Origem · Status**, ordered by confidence, with
URL-state search and pagination. ADMIN and MANAGER may aprovar/remover;
MEMBER is read-only (re-asserted server-side on every action).

### Seed

`npm run db:seed` ships 18 topic-aligned catalog products and **50
matches** generated through the real matcher engine — 20 `AI` · 20
`RULE` · 10 `MANUAL`, confidence between `0.55` and `0.99` — using the
existing `ExternalContent` rows. Idempotent.

---

## AI Context Audit (PR007.1)

Retrocompatible hotfix on top of the AI Personalization Engine (PR007).
Every AI-generated message now carries a **complete snapshot of the
structured context** that produced it — creator, product, campaign and
trend — so any generated content can be audited and reproduced later.

**Nothing from PR007 changed**: the Responses API client, the prompt
templates, the cache contract and the dashboard behave exactly as before.

### Context Snapshot

`AIGeneratedMessage.contextSnapshot` (new nullable `JSONB` column, purely
additive migration) persists the stable object built by
`serializeContext()` (`modules/ai/personalization/context-builder.ts`):

```json
{
  "creator": { "id": "…", "name": "…", "handle": "…", "niche": "…", "score": 82 },
  "product": { "id": "…", "name": "…", "margin": 3550 },
  "campaign": { "id": "…", "name": "…" },
  "trend": { "keyword": "streetwear", "score": 87 }
}
```

- `creator.score` mirrors `CreatorProfile.creatorScore` (0–100).
- `product.margin` mirrors `Product.marginBps` (basis points, 3550 = 35.50%).
- `trend` is `null` for non trend-driven generations.
- Uncaptured optionals serialize as `null`, never omitted — the shape is
  frozen and JSON-stable (fixed key order, byte-identical for equal input).
- The column is **nullable only for backwards compatibility**: rows
  generated before PR007.1 carry `NULL`; every new row is snapshotted at
  generation time.

> **Cache invariant:** `serializeContext()` is audit-only. The cache key
> remains `serializeContextForHash()` + `buildContextHash()` exactly as
> shipped in PR007 — the snapshot is never hashed, and `creator.score` /
> `product.margin` participate in neither the prompt nor the hash, so the
> existing cache keeps hitting across the hotfix.

### Prompt Audit

Each row already pins `promptVersion`, `model`, `temperature`,
`inputTokens`, `outputTokens` and `contextHash` (PR007). Combined with the
new snapshot, a message answers _"which exact context, prompt version and
sampling parameters produced this content?"_ — the full prompt-audit
trail, tenant-scoped via `aiMessageRepository.findWithContext()`.

### Dashboard — "Ver contexto"

`/dashboard/ai` gains a **Ver contexto** button per message (the rest of
the dashboard is untouched). It opens a read-only modal with:

- **Creator · Produto · Campanha · Trend** — from the persisted snapshot
  (falling back to the current record names for pre-PR007.1 rows),
- **Prompt Version · Model · Temperature · Tokens · Context Hash**,
- the **formatted JSON snapshot**, strictly read-only.

Data is fetched lazily by `getAiMessageContextAction()` (server action,
tenant-scoped, read-only — generation stays MANAGER-only).

### Context Diff

`compareContextSnapshots(a, b)`
(`modules/ai/audit/context-diff.ts`, pure, zero dependencies) diffs two
snapshots field by field and returns deterministic dotted-path entries:

```ts
compareContextSnapshots(snapshotA, snapshotB);
// [
//   { path: "creator.score",  before: 82,   after: 91 },
//   { path: "product.margin", before: 3550, after: 3990 },
//   { path: "trend.keyword",  before: "streetwear", after: "y2k" },
// ]
```

Use it to answer _"what changed between these two generations?"_ — e.g.
same creator/product/campaign whose score, margin or trend moved between
snapshots.

---

## Analytics & Attribution (PR008)

Deterministic analytics pipeline that materializes revenue, margin and
attribution metrics per tenant — computed **only** from the workspace's
own rows (`Sale` · `Product` · `CreatorProfile` · `Campaign` ·
`AIGeneratedMessage`). **No external tracking, no randomness, no network,
no new dependencies** (the share bars are plain CSS).

### Metrics pipeline

- **Materialized snapshots.** `AnalyticsSnapshot` (purely additive model,
  nullable-free, Cascade on tenant) persists a versioned `metrics` JSON
  payload per `(organizationId, from, to)` — UNIQUE key, recomputation
  upserts and never duplicates. Snapshots are purely derived data:
  deleting them loses nothing, the pipeline regenerates.
- **Lazy + explicit refresh.** The dashboard serves the snapshot for the
  `(tenant, period)` key; when missing (or a legacy/foreign `version` is
  found) it computes and persists on the spot. The **Recalcular** button
  (`refreshAnalyticsAction`, MANAGER+) forces recomputation. A `stale`
  flag (sales updated after `computedAt`) is surfaced to the reader.
- **Revenue convention:** only `PAID` sales count as revenue (mirrors
  `modules/sales`). PENDING are the pipeline; REFUNDED/CANCELLED never
  count. Money = integer cents, rates = integer basis points.
- **Attribution:** every PAID sale is assigned to exactly one product /
  creator / campaign bucket — `SetNull` relations fall into a synthetic
  _"— Sem atribuição"_ bucket so no cent disappears and shares always
  sum to ~100%. Shares are integer bps (`shareBps`).
- **Determinism contract:** same rows + same period → byte-identical JSON
  (sorted ranking: revenue desc · label asc · key asc; dates are UTC
  ISO strings; `now` is injectable in the service).

### Dashboard `/dashboard/analytics` (MANAGER+)

KPIs — **Receita (PAID) · Margem bruta BRL + % · Ticket médio · Pipeline
pendente (reembolsos/canceladas) · ROI sobre COGS estimado · Uso de IA
(custo USD estimado + tokens + mensagens)** — period selector 7/30/90d,
"Recalcular" action, and three attribution tables (Produto · Creator ·
Campanha) with revenue, sales, units and share %. Revenue/margin are
business-sensitive: MEMBER users are redirected to `/dashboard`.

### Architecture

```text
modules/analytics/
├── metrics/          sales-metrics.ts · attribution.ts · snapshot-builder.ts
│                     (pure: totals · margin/ROI bps · share bps · versioned payload)
├── repositories/     analytics.repository.ts — tenant scope ALWAYS 1st arg
│                     (sale scope mirrors modules/sales until Sale gains organizationId)
├── services/         analytics.service.ts — lazy pipeline (snapshot-first,
│                     compute+persist on miss, refresh() forcing recompute,
│                     stale detection via max(sale.updatedAt))
├── seed/             sales-seed.ts — 40 deterministic sales for the dashboard
└── validators/       analytics.validator.ts — days coerced/bounded (1–365, default 30)
```

### Seed

`npm run db:seed` ships **40 deterministic sales** (28 PAID · 5 PENDING ·
4 REFUNDED · 3 CANCELLED) over the last 30 days, linked round-robin to the
workspace's real products/creators/campaigns (`seed-sale-###` references).
Idempotent: inserted only when the workspace has no sales at all.
