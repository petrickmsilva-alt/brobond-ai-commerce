<div align="center">

# ✦ Brobond AI Commerce OS

**The enterprise operating system for creator-driven social commerce.**

Production-ready foundation · Modular architecture · Built to scale.

[![CI](https://github.com/petrickmsilva-alt/brobond-ai-commerce/actions/workflows/ci.yml/badge.svg)](https://github.com/petrickmsilva-alt/brobond-ai-commerce/actions/workflows/ci.yml)

</div>

---

## Overview

Brobond AI Commerce OS is a SaaS platform that connects **products**, **creators**,
and **campaigns** into a single operating system for social commerce. This repository
contains **PR000 — Bootstrap Foundation**: the production-ready infrastructure,
architecture, and UI shell that every subsequent feature builds on.

> **Scope of PR000.** This PR ships infrastructure and prepared interfaces only.
> TikTok API, OpenAI, scraping, and the analytics pipeline are **intentionally not
> implemented** — their contracts are defined so future PRs can plug in cleanly.

---

## Tech Stack

| Layer          | Technology                                   |
| -------------- | -------------------------------------------- |
| Framework      | Next.js 15 (App Router) · React 19           |
| Language       | TypeScript (strict)                          |
| Styling        | Tailwind CSS v4 · Inter · dark premium theme |
| ORM / Database | Prisma ORM · PostgreSQL                      |
| Auth           | NextAuth v5 (Prisma adapter, JWT sessions)   |
| Forms          | React Hook Form · Zod                        |
| Icons          | Lucide                                       |
| Tooling        | ESLint · Prettier · Docker · GitHub Actions  |
| Deploy         | Render (Blueprint)                           |

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
│   ├── login/                            Auth screen (RHF + Zod)
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
├── lib/              prisma · auth · env · utils · navigation · constants
│   └── validations/  auth
├── hooks/            use-sidebar · use-media-query
├── types/            index · next-auth.d.ts
├── prisma/           schema.prisma · seed.ts
├── public/           favicon.svg
├── styles/           globals.css (Tailwind v4 theme)
├── Dockerfile · docker-compose.yml · render.yaml
├── .env.example · .github/workflows/{ci,deploy}.yml
```

### Data model

Six core models plus join tables and NextAuth adapter tables:

- **User** — team members with roles (`ADMIN`, `MANAGER`, `MEMBER`).
- **Product** — catalog items with pricing and publication status.
- **Creator** — creator roster (`externalId` reserved for TikTok).
- **Campaign** — orchestration linking products ⇄ creators (M:N).
- **Message** — conversations across channels (system/email/DM/SMS).
- **Sale** — revenue records tied to product/creator/campaign.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- Docker (for local PostgreSQL) — or any PostgreSQL 14+ instance

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# → set AUTH_SECRET (openssl rand -base64 32) and DATABASE_URL

# 3. Start PostgreSQL (via docker-compose)
docker compose up -d db

# 4. Generate the Prisma client & apply the schema
npm run prisma:generate
npm run prisma:migrate   # creates the initial migration

# 5. (Optional) Seed demo data
npm run db:seed

# 6. Run the dev server
npm run dev
```

App runs at **http://localhost:3000**.

### Useful scripts

| Script                   | Description                          |
| ------------------------ | ------------------------------------ |
| `npm run dev`            | Start the Next.js dev server         |
| `npm run build`          | `prisma generate` + production build |
| `npm run start`          | Run the production server            |
| `npm run lint`           | ESLint                               |
| `npm run format`         | Prettier (write)                     |
| `npm run typecheck`      | TypeScript, no emit                  |
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
   Set `APP_URL` to your service URL.
5. `preDeployCommand` runs `prisma migrate deploy` before each release.

### CI/CD

| Trigger              | Workflow                       | Actions                                               |
| -------------------- | ------------------------------ | ----------------------------------------------------- |
| **Open / update PR** | `.github/workflows/ci.yml`     | `npm install` → `prisma generate` → `lint` → `build`  |
| **Merge to `main`**  | `.github/workflows/deploy.yml` | Trigger Render deploy (hook) — Blueprint auto-deploys |

> With `autoDeploy: true` in the Blueprint, Render redeploys on every push to `main`.
> The deploy workflow additionally supports an explicit `RENDER_DEPLOY_HOOK_URL`
> repository secret for manual/controlled triggers.

---

## Module map

| Module                        | Responsibility          | Status in PR000                 |
| ----------------------------- | ----------------------- | ------------------------------- |
| `modules/products`            | Catalog data access     | ✅ Service scaffold             |
| `modules/creators`            | Creator roster          | ✅ Service scaffold             |
| `modules/campaigns`           | Campaign orchestration  | ✅ Service scaffold             |
| `modules/sales`               | Revenue records         | ✅ Service scaffold             |
| `modules/analytics`           | Metrics & reporting     | 🧩 Interface only (PR006)       |
| `modules/integrations/tiktok` | TikTok API / OAuth      | 🧩 Interface only (PR002/PR004) |
| `modules/integrations/ai`     | AI provider (OpenAI, …) | 🧩 Interface only (PR003)       |

---

## Roadmap

| PR        | Title                   | Scope                                                               |
| --------- | ----------------------- | ------------------------------------------------------------------- |
| **PR000** | Bootstrap Foundation    | Infra, architecture, dark UI shell, Prisma schema, Docker, CI/CD ✅ |
| **PR001** | Products CRUD           | Full product management (create/edit/list), server actions, tables  |
| **PR002** | Creators & TikTok Link  | Creator CRUD + TikTok OAuth & profile sync (implements interface)   |
| **PR003** | AI Assistant            | OpenAI provider implementation, content & outreach generation       |
| **PR004** | Campaign Engine         | Campaign builder, product/creator assignment, scheduling            |
| **PR005** | Messaging & Inbox       | Conversations, notifications, multi-channel delivery                |
| **PR006** | Analytics & Reporting   | Metrics pipeline, dashboards, revenue attribution                   |
| **PR007** | Billing & Multi-tenancy | Subscriptions, workspaces, roles & permissions hardening            |

---

## License

Proprietary © Brobond. All rights reserved.
