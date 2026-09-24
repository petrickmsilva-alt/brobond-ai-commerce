# PROJECT STATE — Brobond AI Commerce OS

### PR010.4.6 — Prisma driver adapter configuration cleanup (2026-09-23) — completed (via PR010.4.7)

- **The schema property is not redundant on Prisma 6.19.3.** Removing only
  `url = env("DATABASE_URL")` makes both `prisma validate` and `prisma migrate
deploy` stop with `P1012: Argument "url" is missing in data source block
"db"`. The property therefore remains in `prisma/schema.prisma`; `provider =
"postgresql"` is unchanged.
- `prisma.config.ts` also remains unchanged and continues to supply the actual
  CLI connection through `process.env.DATABASE_URL`, `PrismaPg`, and `engine:
"js"`. Prisma 6.19.3 emits the adapter warning even though its schema parser
  still requires the ignored `url` property, so that warning cannot be removed
  safely under this hotfix's version and configuration constraints.
- **New root cause after the warning.** A migration smoke test against a valid
  local PostgreSQL-compatible server loaded the config and datasource, found
  all 17 migrations, and reported no missing module or `DATABASE_URL` failure.
  It then failed in the JavaScript schema engine with `Column type 'name' could
not be deserialized from the database` while initializing migration
  persistence. `@prisma/adapter-pg@6.19.3` does not map PostgreSQL system type
  OID 19 (`name`), matching upstream `prisma/prisma#27403`.
- **Production-tree equivalence.** `npm ci --omit=dev` retained the Prisma CLI,
  config loader, adapter, `effect`, and `fast-check`; running the same migration
  command from that tree reached the same OID 19 failure with no
  `MODULE_NOT_FOUND` error.
- **Resolution — PR010.4.7 (Prisma Runtime Strategy Split).** Instead of a
  dependency upgrade, model change, migration change, or production behavior
  change, the fix splits the Prisma engine strategy by execution context:
  the runtime (`lib/prisma.ts`, Next.js, Server Actions, API Routes) keeps
  `new PrismaPg()` and the JS engine unchanged; the CLI (`prisma.config.ts`)
  detects migration-related commands (`migrate`, `db`, `studio`) and drops
  the adapter + JS engine in favour of the native Rust query engine, which
  bypasses the OID 19 deserializer bug entirely. See PR010.4.7 below.

### PR010.4.7 — Prisma Runtime Strategy Split (2026-09-24) — completed

- **Symptom.** `prisma migrate deploy` (and `prisma db push`, `prisma studio`)
  failed in the JavaScript schema engine with `Column type 'name' could not be
  deserialized from the database` — PostgreSQL system type OID 19 (`name`) has
  no mapping in `@prisma/adapter-pg@6.19.3` / the JS engine (upstream
  `prisma/prisma#27403`). The same command worked in the past because the
  native Rust query engine was used by default; the project had switched the CLI
  to `engine = "js"` + `PrismaPg` adapter via `prisma.config.ts` (PR010.4.5
  era) to fix a different runtime problem, which regressed migration commands.
- **Scope.** Only the Prisma CLI path is affected. The Next.js runtime
  (`lib/prisma.ts`, Server Actions, API Routes, `getPrisma()`) already uses
  its own `new PrismaPg()` singleton and never loads `prisma.config.ts`, so it
  is untouched by this change.
- **Fix — strategy split in `prisma.config.ts`.**
  - A detection helper `isMigrationCommand()` checks `process.argv` for
    `migrate`, `db`, or `studio` (covers `prisma migrate deploy`,
    `prisma migrate dev`, `prisma db push`, `prisma studio`, and subcommands
    spelled either way).
  - When a migration command is detected: `engine` is unset (native Rust engine
    chosen by Prisma) and `adapter` returns `undefined` — no `PrismaPg` is
    created, so the OID 19 deserializer bug is never reached.
  - For all other CLI commands (`validate`, `format`, etc.): the existing
    `engine = "js"` + `PrismaPg` adapter path is preserved unchanged.
- **`lib/prisma.ts` — unchanged.** The runtime singleton (`getPrisma()`,
  `prisma` proxy facade, lazy init, `DATABASE_URL` gate) is exactly as before.
  Server Actions and API routes continue to use `PrismaPg` with no behaviour
  change.
- **`prisma/schema.prisma` — unchanged.** `generator client { engineType =
  "client" }` and `datasource { url = env("DATABASE_URL") }` are untouched.
- **Render — unchanged.** `preDeployCommand: npx prisma migrate deploy` and
  `startCommand` both now run the migration command through the native engine
  path, so Render deploys use the same split as local development. No manual
  SQL, no disabled migrations, no `prisma.config.ts` copy in the Docker
  runner.
- **Smoke test (`scripts/smoke-prisma-migrate-runtime.sh` /
  `npm run smoke:prisma-runtime`) — still valid.** The script copies
  `prisma.config.ts` into a clean production tree and runs `npx prisma migrate
  deploy`. With the split, that command now reaches the migration setup path
  under the native engine instead of failing at the OID 19 deserializer. A
  `MODULE_NOT_FOUND` still fails the test; a connection error (unreachable DB)
  is still the expected pass state without `SMOKE_DATABASE_URL`.
- **Verified commands (local, no live DB required for most):**
  - `npm ci` — installs intact.
  - `npx prisma validate` — JS engine + adapter path (non-migration command).
  - `npx prisma generate` — native engine, no adapter (generate is not a
    migration command, but the native client generator is used regardless;
    the split preserves this).
  - `npx prisma migrate deploy` — native engine, no adapter (migration command
    detected; bypasses the OID 19 deserializer).
  - `npm run build` — `prisma generate` runs first (native), then Next.js
    build uses the generated client + `lib/prisma.ts` at runtime.
  - `lib/prisma.ts` is never loaded by the CLI, so the runtime adapter path is
    unaffected.

### PR010.4.5 — Prisma migration runtime dependencies (2026-09-23) — completed

- **Symptom.** The build passed, but the Render deploy failed in the
  `preDeployCommand: npx prisma migrate deploy` with
  `Error: Cannot find module 'fast-check'`, require stack
  `@prisma/config → effect → fast-check`.
- **Root cause.** `prisma.config.ts` makes the Prisma CLI load
  `prisma/config` → `@prisma/config@6.19.3`, which eagerly `require("effect")`;
  `effect/dist/cjs/FastCheck.js` in turn eagerly `require("fast-check")`.
  `fast-check@3.23.2` is a **normal transitive dependency** (not optional/peer)
  that npm **hoists to the top-level `node_modules/fast-check`**. Any runtime
  that ships `@prisma/config` without also shipping that hoisted `fast-check`
  breaks. The Dockerfile's runner stage hand-copied a curated list of ~20 CLI
  packages but never included the hoisted `fast-check` / `pure-rand` /
  `empathic`, so the CLI aborted before touching the database. Reproduced with
  the identical require stack by replaying the Dockerfile's exact copy list.
- **Dependency tree (Prisma 6.19.3).** `prisma@6.19.3` →
  `@prisma/config@6.19.3` → `effect@3.21.0` (nested) → `fast-check@^3.23.1`
  (resolved 3.23.2, hoisted) → `pure-rand@6.1.0`; plus `empathic@2.0.0`,
  `c12`, `deepmerge-ts` under `@prisma/config`. The project also has a direct
  `effect@3.22.2` which independently requires the same `fast-check`.
- **Fix — dependency tree.** Promoted `fast-check` to a **direct production
  dependency** at the range the tree already requires (`^3.23.1`; no arbitrary
  version pinned), so npm guarantees it survives dependency pruning in every
  runtime path (`npm ci`, `npm ci --omit=dev`, Render, Docker). Lock file
  regenerated with `npm install`.
- **Fix — Docker.** Replaced the fragile hand-maintained package copy list
  (which re-implemented npm's resolution and drifted) with a dedicated
  `npm ci --omit=dev` stage (`proddeps`) whose **complete** production tree is
  copied wholesale into the runner. This is exactly the tree Render installs
  for the `preDeployCommand`, cannot drift from the lock file, and always
  contains the CLI + its full closure (`@prisma/config`, `effect`,
  `fast-check`, `pure-rand`, `empathic`, the `pg` driver, the TypeScript/jiti
  loader). The generated `.prisma` client dir is still copied afterwards for
  the `query_compiler_bg.wasm` runtime asset.
- **Render.** Unchanged and intentionally so: `preDeployCommand: npx prisma
migrate deploy`, `DATABASE_URL.fromDatabase` and the Prisma-owned migration
  path all remain. No manual SQL, no disabled migrations.
- **Smoke test (mandatory).** `scripts/smoke-prisma-migrate-runtime.sh`
  (`npm run smoke:prisma-runtime`) rebuilds the production runtime in a clean
  dir with `npm ci --omit=dev`, asserts the required packages are present, then
  runs `prisma migrate deploy` and fails on any `MODULE_NOT_FOUND` while
  proving the CLI loaded `prisma.config.ts` and its full closure (a mere DB
  _connection_ error is the expected pass state without a live database). Wired
  into CI (`.github/workflows/ci.yml`).
- **Regression.** `npm ci`, `npx prisma validate`, `npx prisma generate`,
  `npx prisma migrate deploy` (loads with no MODULE_NOT_FOUND), `npm run lint`,
  `npm run typecheck`, `npm test` (2670 passed, 1 skipped), `npm run build`,
  `npm run format:check`, and `npm run smoke:prisma-runtime` all pass.

### PR010.4.3 — Prisma lazy initialization (2026-09-23) — completed

- **Build/runtime environment separation:** importing `lib/prisma.ts` is now
  side-effect free. `getPrisma()` validates `DATABASE_URL` and creates the
  process-wide Prisma/pg singleton only on first runtime database use; the
  backwards-compatible `prisma` proxy is lazy as well.
- **BUILD:** `next build` does **not** require `DATABASE_URL`; route collection
  can import database-backed modules without opening a pool or reading the
  runtime secret.
- **RUNTIME:** database operations still require `DATABASE_URL` and fail
  explicitly when it is absent. No fallback connection or mock data exists.
- Instagram callback and database health routes are force-dynamic Node.js
  handlers. Health output is sanitized, and signup maps missing runtime
  database configuration to `PRISMA_UNAVAILABLE` with the friendly message
  "Banco de dados temporariamente indisponível."
- Render keeps `DATABASE_URL.fromDatabase` and `preDeployCommand: npx prisma
migrate deploy` unchanged.

### PR010.4 — Enterprise Self Signup & Onboarding (2026-09-23) — completed

PR010.3 perfected a funnel that started with a stranger asking permission.
PR010.4 deletes that funnel. The product now onboards itself: a visitor lands
on `/signup`, fills seven fields, and forty seconds later is inside a
provisioned workspace looking at a four-step checklist. Access requests,
approval queues and mandatory invitations are gone as a **precondition** —
invitations survive only for their real purpose, adding someone to an
**existing** tenant.

- **§1 Request-access removed, entirely.** Deleted: `/request-access` and
  `/request-access/success`, `components/auth/request-access-form.tsx`,
  `/dashboard/settings/access` (page + actions), the settings queue panel and
  table, `modules/auth/access-request.service.ts`,
  `modules/auth/approval.service.ts`, the `AccessRequest` model and the
  `AccessRequestStatus` enum, and every "Solicitar acesso" CTA. The approval
  service's one surviving responsibility — send the invitation email the
  moment it is issued — moved to `modules/auth/invitation-delivery.service.ts`,
  so `/settings` still delivers invites through the same `InvitationMailer`
  seam. Migration: `…_self_signup_first_tenant`.
- **§2 `/signup` — premium two-column screen.** Brand aside (proof points,
  `PlatformStatus`) + form column, glass panels, `bg-premium-glow` /
  `bg-app-mesh`, the shared motion primitives; collapses to one column below
  `lg`. A signed-in visitor is redirected away server-side. Google is offered
  here too, behind the same `showGoogleProvider()` predicate as `/login`.
- **§3 Seven required fields, validated as you type.** Nome completo ·
  Empresa · WhatsApp · Email · Senha · Confirmar senha · Aceite dos termos.
  RHF with `mode: "onChange"` and `reValidateMode: "onChange"` over the SAME
  `signupSchema` the server parses, `noValidate` so the shared rules are the
  only rules, password strength meter, show/hide on both password fields.
- **§4 One submit provisions a tenant.** `signupService.register()` runs a
  single transaction: `Organization` (unique slug derived from the company
  name, reserved words like `login`/`signup`/`api` suffixed so a workspace can
  never shadow a route) + first `User` with **role ADMIN** and a bcrypt
  (cost 12) `passwordHash` + workspace defaults (`workspaceName`, `whatsapp`,
  **BRL · pt-BR · America/Sao_Paulo**, `selfServe: true`) + the initial seed
  (`MessageTemplate` rows from `OUTREACH_TEMPLATES`, `createMany` +
  `skipDuplicates`). Then `signIn("credentials", { redirect: false })` and a
  server-decided redirect to `/dashboard`.
- **§5 Google first access.** Implemented in `lib/auth-adapter.ts` by
  overriding **`createUser`** on the stock `PrismaAdapter` — not in the
  `signIn` callback, which runs before NextAuth's own linking and would leave
  the user with `AccountNotLinked`. Unknown email → full tenant provisioning
  (ADMIN, workspace, defaults, seed); known email → NextAuth resolves them
  through the untouched `getUserByEmail` and they simply log in, with no
  re-provisioning and **no re-elevation** of their role. Company name is
  inferred from the email domain, ignoring free-mail providers.
- **§6/§7 Entry points.** `/login` gains a real "Criar conta" outline button
  (`buildSignupUrl(next)`, so the `?next=` destination survives the hand-off);
  the landing hero shows **Criar Conta** primary + **Fazer Login** secondary,
  and the marketing header offers "Criar conta" to anonymous visitors only.
- **§8 Errors belong to fields.** Every rule carries a written Portuguese
  message rendered **below its own input** (`data-field-error`, `aria-invalid`,
  `aria-describedby`): "Informe o nome da empresa.", "WhatsApp inválido.",
  "A senha deve ter ao menos 8 caracteres.", "Este email já está sendo
  utilizado.", "As senhas não coincidem." Server-side field errors are
  replayed onto the same inputs via `setError`, the summary is always a
  concrete first problem, and the string "Revise os campos destacados" exists
  nowhere in the flow. Even the database's unique-index violation (`P2002`)
  is mapped back to the email field.
- **§9 Onboarding checklist on `/dashboard`.** Conectar TikTok · Importar
  Produtos · Criar Creator · Criar Campanha. Progress is **derived from live
  tenant counts**, never stored, so a step ticks whether the record arrived by
  hand or through the TikTok sync — the panel can never disagree with the
  workspace. It hides itself when all four are done, or when dismissed
  (`Organization.onboardingCompletedAt`, idempotent).
- **First-tenant columns, no `Workspace` model.** A workspace _is_ an
  `Organization`: `workspaceName`, `whatsapp`, `currency`, `locale`,
  `timezone`, `onboardingCompletedAt`, `selfServe`. Adding a second model
  would have duplicated the tenant boundary that every query already uses.
- **NextAuth intact.** Providers, JWT/session callbacks, middleware and the
  `organizationId`-in-token contract are unchanged; only the `signIn` callback
  (which used to reject unknown OAuth emails) and the adapter were touched.
- **§10 Tests: 2,276 → 2,632 (+356) across 130 files**, despite deleting the
  95 tests that covered the removed flow — a net +451 written. New suites:
  `signup-validation` (82), `signup-service` (68), `signup-tenant-provisioning`
  (94), `signup-action` (47), `signup-google-first-login` (28),
  `signup-onboarding` (37), `signup-ui-contracts` (90). The 1,800 meta is
  exceeded with margin.

### PR010.3 — Complete Authentication Flow (2026-09-23) — completed

Closes the loop PR010.2 opened. The primitives existed (access request,
invitation, Google provider behind env flags); PR010.3 connects them into the
flow a user actually experiences: request → approval → **automatic invitation**
→ email delivery seam → single-use redemption → dashboard, with a terminal
page for every dead end.

- **§1 Access request → confirmation page.** `/request-access` still writes one
  inert `AccessRequest` row (`name`/`company`/`email`/`whatsapp`/`message` —
  the PR010.2 column names for the spec's `fullName`/`organizationName`/
  `phone`; no schema churn, no migration). After success the form navigates to
  `/request-access/success` with `router.replace` — the populated form leaves
  the history stack, so the back button can never resurrect it ("nunca
  retornar para o formulário").
- **§2 ADMIN approval — `/dashboard/settings/access`.** New ADMIN-only page
  (restricted state for MANAGER/MEMBER; `requireAdmin()` in every action is
  the enforcement) with the full table: Nome · Empresa · Email · Telefone ·
  Status · **Aprovar / Rejeitar**. **"Ao aprovar: Criar Invitation"** — the
  PR010.2 two-step (approve, then invite manually) collapsed into one action,
  because the second click was the one operators forgot. An invitation is
  still not an account: the invitee must redeem the single-use link.
- **§3/§4 Invitation & user creation — unchanged where it matters.**
  `/invite/[token]` validates server-side, the invitee sets a password, a
  `User` is created with bcrypt `passwordHash`, `role` from the invitation
  (MEMBER for access-request approvals), `organizationId` from the invitation,
  auto sign-in through the normal Credentials provider, redirect to
  `/dashboard`. No public sign-up exists anywhere.
- **§5 Google — two env conventions, one predicate.** `GOOGLE_CLIENT_ID` +
  `GOOGLE_CLIENT_SECRET` (§12) join `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`
  as equivalent enablers. A pair only counts when complete; mixing one
  variable from each pair does NOT enable the provider. Button visible or
  absent — never disabled — and `lib/auth.ts` registers the provider through
  the same `resolveGoogleCredentials()`, so UI and `/api/auth/signin/google`
  cannot disagree.
- **§9 Email service — `InvitationMailer`.** The interface +
  `ConsoleMailer` (logs the full invitation email, greppable prefix) +
  `createInvitationMailer()` factory. Every invitation — approved request or
  manual invite — is delivered through it; a future `ResendMailer` implements
  the same interface and only the factory changes. Mailer failure is
  non-fatal: the invitation exists, `delivered: false` is reported, the ADMIN
  can re-send (which rotates the token).
- **§10 Terminal pages.** `/invite/invalid` (unknown/used/revoked) and
  `/invite/expired` (ran out of time) — distinct messages because the fix
  differs — plus `/request-access/success`. `/invite/[token]` redirects to
  them instead of rendering an inline error.
- **§12 `APP_URL`.** Canonical public base URL for human-facing links
  (invitation URLs), falling back to `NEXTAUTH_URL` (`lib/app-url.ts`).
  NextAuth itself keeps using `NEXTAUTH_URL` for callbacks. `.env.example`
  and `lib/env.ts` document all three new variables.
- **No NextAuth removal, no tenancy/RBAC change, no Prisma migration** — the
  PR010/PR010.2 contracts hold; `middleware.ts` gained only an `APP_URL`
  https check for the `__Secure-` cookie decision.
- **§11 Tests: suite grows from 2,090 to 2,276 tests (+186)** across 127
  files — approval orchestration, mailer contract, invite redirect routing
  (page components executed directly), request-access success flow, Google
  env-alias visibility, the new admin route, and middleware coverage for the
  new routes. The 1,750 meta is exceeded with margin.

### PR010.2 — Enterprise Authentication & UX (2026-09-23) — completed

- **The bug that started it:** the landing header linked "Dashboard" straight
  at `/dashboard`. A visitor without a session hit a Server Component whose
  `requireUser()` threw, and Next.js rendered an unstyled white page with a
  digest hash. The most prominent button on the marketing site led to a dead
  end. PR010.2 closes that hole at three layers — the CTA, the perimeter, and
  the error boundary — and builds out the account lifecycle that was missing
  around it.
- **§1 Landing CTA — never navigates blindly.** `components/marketing/landing-header.tsx`
  is a Server Component receiving one boolean: `authenticated` → `/dashboard`,
  otherwise → `/login?next=%2Fdashboard`. The href is resolved server-side, so
  it is correct in the first paint, needs no JavaScript, and cannot flash the
  wrong destination. "Entrar" is always `/login`.
- **§2 Perimeter — `middleware.ts`.** Protects `/dashboard`, `/products`,
  `/creators`, `/campaigns`, `/analytics`, `/outreach`, `/ai`, `/matches`,
  `/connectors` (plus `/settings`) and redirects anonymous traffic to
  `/login?next=<currentPath>` with the querystring preserved. It decodes the
  JWT with `getToken({ cookieName })` — the salt defaults to the cookie name,
  so it must be passed explicitly — and bypasses `/api/auth`, webhooks,
  OAuth callbacks and static assets without ever reading a token.
- **Open-redirect defence.** `lib/auth-routes.ts` is the single sanitiser used
  by the middleware, the landing header, the login page _and_ the login
  action. `sanitizeNext()` accepts only same-origin absolute paths, rejecting
  `//host`, `/\host`, backslashes, `scheme:`, relative paths, control
  characters and `%0a/%0d/%09` (checked on the **raw** string, before
  `trim()`, so a trailing CRLF is rejected rather than silently trimmed), and
  refuses auth routes to prevent redirect loops.
- **§3 Login refactor.** Two columns: brand, headline, benefícios and status
  da plataforma on the left; a glass card with email, senha, Entrar, Google
  (conditional), Esqueci senha and Solicitar acesso on the right. An already
  authenticated visitor is redirected before the form renders.
- **§4 Google SSO is hidden, never disabled.** PR010.1 shipped a permanently
  `disabled` Google button with an apologetic caption; a control that can
  never be used reads as a broken page. `showGoogleProvider()`
  (`lib/auth-providers.ts`) requires **both** `AUTH_GOOGLE_ID` and
  `AUTH_GOOGLE_SECRET` — a half-configured provider would render a button that
  dies at the callback — and `lib/auth.ts` registers the provider with the
  same predicate, so UI and auth config cannot drift. No provider → the
  component returns `null`, and the "ou" divider disappears with it. The
  client receives one boolean; the credentials never enter the bundle.
- **§5 `/request-access`.** A public form (Nome, Empresa, Email, WhatsApp,
  Mensagem) writing one inert `AccessRequest` row with status `PENDING`. It is
  a _lead_, not an account: no password, no role, no tenant, and nothing in
  the authentication path reads it. Re-submitting while a request is pending
  updates the existing row, so a scripted flood cannot swamp the ADMIN queue.
- **§6 `/forgot-password` → `/reset-password`.** Email → token → nova senha,
  expiring in exactly **30 minutes**. No user enumeration: known and unknown
  emails get an identical response shape and an identical confirmation screen,
  and nothing is written for an unknown address. Issuing a token invalidates
  every outstanding one; consuming it is single-use and does **not** auto-login.
- **§7 `/invite/[token]`.** Public by design (the token _is_ the credential).
  The page previews organização and role, the invitee sets a password, and the
  action auto-signs them in. Role and tenant are read from the stored
  invitation, never from the client payload, so a crafted request cannot
  escalate to ADMIN. Re-inviting a pending email rotates the token and kills
  the old link.
- **Token security.** `lib/tokens.ts` generates 32 bytes of entropy
  (base64url) and persists **only** the SHA-256 digest — a database dump
  yields no usable link. Acceptance and password reset run as status-guarded
  `updateMany` inside a `$transaction`, so a replayed link cannot create a
  second account or rewrite a password twice.
- **§8 Error boundaries — "remover erro branco".** `components/ui/error-state.tsx`
  renders a branded surface with **Voltar ao Dashboard**, **Recarregar**
  (prefers `reset()` over a reload, preserving scroll and shell) and
  **Copiar ID**, wired into `app/error.tsx`, `app/dashboard/error.tsx` and
  `app/global-error.tsx`. Only `error.digest` is shown in production —
  `error.message` can carry a query, a connection string or a tenant id, so it
  appears in development only. `global-error.tsx` replaces the root layout, so
  it renders its own `<html>`/`<body>`, imports nothing but React and styles
  everything inline; the app CSS may never have loaded.
- **§9 Loading states.** `app/loading.tsx`, `app/login/loading.tsx` and
  `app/dashboard/loading.tsx`, backed by new `PageHeaderSkeleton`,
  `DashboardSkeleton`, `ListPageSkeleton` and `AuthCardSkeleton` primitives.
- **§10 Empty states with a CTA.** `components/ui/table-empty-state.tsx`
  distinguishes _no data yet_ (a creation CTA — "Importar produtos",
  "Sincronizar TikTok", "Importar conteúdo") from _filters matched nothing_
  ("Limpar filtros"), reading `useSearchParams()` against a `FILTER_KEYS`
  list. The CTA is supplied by the caller so RBAC stays on the page. Wired
  into the products, creators, connector-content and matches tables.
- **§11 RBAC.** ADMIN manages invitations and reviews access requests;
  MANAGER cannot invite; MEMBER is read-only. `canManage` hides affordances,
  but `requireAdmin()` inside every server action is the real gate. The invite
  role enum is `MANAGER | MEMBER` only — an ADMIN cannot mint another ADMIN
  through a link. Approving an access request records a decision and
  provisions nothing; a separate, explicit invitation is the only code path
  that creates a `User`, so PR000.2's "no public sign-up" contract holds.
- **§13 UI.** Glassmorphism, radius 16, premium gradient and Framer Motion
  entrances (`SlideIn` for the brand column, `FadeIn` for the cards), all
  inert under `prefers-reduced-motion`. Every field is labelled, errors are
  wired through `aria-invalid` + `aria-describedby`, and form-level errors are
  `role="alert"` live regions.
- **Schema (additive only).** Two enums (`InvitationStatus`,
  `AccessRequestStatus`) and three models (`Invitation`,
  `PasswordResetToken`, `AccessRequest`) plus two back-relations. No existing
  model or enum was modified. Migration:
  `20260928090000_enterprise_authentication_ux`.
- **Environment.** `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` added to
  `lib/env.ts` and `.env.example` as an optional pair — both or neither.
- **§12 Tests:** suite grows from 1,818 to **2,090 tests** (+272) across 120
  files. Seven new suites cover route sanitising and open-redirect defence
  (55), the middleware redirect matrix against the real `next/server` (43),
  UI contracts for §1/§3/§4/§9/§10/§11/§13 (42), the invitation flow incl.
  single-use and privilege-escalation attempts (28), error boundaries (27),
  token digests and the 30-minute TTL (24), password reset incl. user
  enumeration (20) and the access-request queue (19).

### PR010 — Omnichannel Delivery Engine (2026-09-23) — completed

- **Official Meta APIs only:** the Instagram Connector uses Facebook Login
  for Instagram Business Messaging and the WhatsApp Connector uses the
  WhatsApp Business Cloud API (Embedded Signup). No scraping, no browser
  automation, no unofficial APIs, no exceptions. Every request is
  server-side; app credentials are read lazily from the environment and
  never serialized into DTOs or browser responses.
- **Crypto:** every Meta token is AES-256-GCM ciphertext
  (`META_ENCRYPTION_KEY`, versioned `v1.iv.tag.value` format), refreshed
  before expiry (Instagram long-lived rotation), destroyed on disconnect.
  OAuth states are random, SHA-256-hashed at rest, single-use and expire in
  ten minutes.
- **Schema:** `DeliveryAccount` (tenant + channel + globally-unique provider
  `accountId` for webhook tenant resolution, encrypted tokens, lifecycle),
  `DeliveryMessage` (tenant + `executionId` idempotency key, status
  lifecycle, provider id, retry scheduling) and `DeliveryOAuthState`.
  Migration: `20260927090000_omnichannel_delivery`.
- **Delivery Engine:** `modules/delivery/` ships a Map-based Delivery
  Factory (the ONLY channel→connector mapping — no switch outside it), one
  `DeliveryConnector` per channel, a dispatcher consuming APPROVED
  `CommerceExecution`s through `QUEUED → SENDING → SENT → DELIVERED → READ`
  with an enforced transition map, and a retry engine (3 attempts,
  deterministic exponential backoff, retryable-only).
- **Idempotency:** enqueue anchored on
  `(organizationId, executionId, channel, recipientId)`; optimistic
  QUEUED→SENDING claim makes concurrent workers safe; webhook receipts are
  forward-only and deduplicated with the tenant-unique
  `AuditLog.externalEventId` key.
- **Webhooks:** `POST /api/webhooks/instagram` and
  `POST /api/webhooks/whatsapp` validate Meta's `X-Hub-Signature-256` HMAC in
  constant time and reject with an immediate **401** before any parsing;
  `GET` handshakes verify `META_VERIFY_TOKEN`. Instagram handles
  `message.received/delivered/read` (+ echo SENT confirmation); WhatsApp
  handles `message_status` (sent/delivered/read/failed) and
  `message_received`. Accepted events write `AuditLog`.
- **Dashboard:** `/dashboard/delivery` (new nav item) shows the contracted
  KPIs — Fila · Enviadas · Entregues · Lidas · Falhas — plus a
  channel/status/campaign-filtered message table with tentativas and tempo
  de entrega, account cards and per-row reprocess. **RBAC §10:** ADMIN
  connects/disconnects/reprocesses; MANAGER sends and dispatches; MEMBER is
  read-only.
- **Analytics:** `AnalyticsSnapshot.metrics` gains an additive `delivery`
  section — `messagesSent`, `messagesDelivered`, `messagesRead`,
  `messagesFailed`, `messagesQueued`, `deliveryRate` and `readRate` (integer
  basis points) — with zero-baseline backfill for pre-PR010 snapshots and a
  matching KPI row on `/dashboard/analytics`.
- **Tests:** suite grows from 1,319 to **1,742 tests** (+423) covering
  crypto, OAuth both channels, webhook security + handlers, retry,
  dispatcher, factory, RBAC, tenant isolation and end-to-end idempotency.

### PR009 — TikTok Shop Connector (2026-09-23) — completed

- **Official API only:** seller OAuth uses TikTok Shop Partner Center's
  authorization/token endpoints and official Product (`202502`), Order
  (`202309`) and Affiliate Seller Creator marketplace APIs. There is no
  scraping, browser automation, Selenium, Playwright or Puppeteer anywhere in
  the connector.
- **OAuth/security:** `/dashboard/tiktok` is ADMIN-only. A random, hashed,
  single-use OAuth `state` expires in ten minutes; callback `/api/tiktok/callback`
  exchanges the code server-side. Access/refresh tokens are AES-256-GCM
  ciphertext (`TIKTOK_ENCRYPTION_KEY`), never sent to a Client Component,
  automatically refreshed five minutes before expiry, and erased on disconnect.
- **Schema:** `TikTokAccount` (tenant + shop identity, encrypted tokens,
  lifecycle, last sync), `TikTokOAuthState` and tenant-scoped `AuditLog`; Product
  has tenant-scoped `tiktokProductId` idempotency. Migration:
  `20260926090000_tiktok_shop_connector`.
- **Sync:** `modules/connectors/tiktok/` has one signed/retrying/rate-aware
  HTTP client, API resources, mappers and importer. It idempotently upserts
  `Product`, `CreatorProfile` and connector `ExternalContent` records without
  duplicates. Orders are read for reconciliation and stay in the finance domain
  until a dedicated order-to-sale policy is approved.
- **Webhooks:** `POST /api/webhooks/tiktok` validates the raw-body TikTok Shop
  HMAC signature in constant time, accepts `product.updated`, `order.created`
  and `creator.updated` (plus official aliases), deduplicates at-least-once
  notifications with `(organizationId, externalEventId)` and writes `AuditLog`.
- **Dashboard:** `/dashboard/tiktok` provides account, products, creators and
  last-sync KPIs plus connect, sync, disconnect and audit log controls. Tokens
  are absent from all DTOs and browser responses.

> Living document tracking the architectural state of the platform.
> Updated per PR. Source of truth for "what exists" vs. "what is planned".

**Last updated:** 2026-09-23
**Current PR:** PR010.3 — Complete Authentication Flow
**Status:** completed (awaiting review/merge — **no merge performed**)
**Branch:** `arena/01a0cf7d-brobond-ai-commerce`
**Next PR:** PR011 — AI CEO & Autonomous Decisions

> **Workflow (instituted in PR001):** no more direct merges to `main`.
> Feature branch → Pull Request → human audit → approval → merge → Render deploy.

---

## 1. Snapshot

| Aspect        | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage         | **Complete Authentication Flow (PR010.3)** shipped on top of Enterprise Authentication & UX (PR010.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Architecture  | **Multi-tenant, enforced** (`organizationId` NOT NULL on domain models) · **multi-source trends** (PR002.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Modules       | `modules/commerce/products` — services / repositories / dto / pricing / validators                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|               | `modules/trends` — hunter (collectors / collector factory / scorer / scheduler) / repositories / dto / …                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|               | `modules/connectors` — core + official `tiktok` OAuth/API/importer/webhook (PR009) + mock / instagram / shopee                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
|               | `modules/campaigns` — Campaign Engine · deterministic AI Matching · ROI Engine · Audience Builder · repositories · dto · validators (PR006)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
|               | `modules/ai` — OpenAI Responses API client · versioned prompts (5 tones) · generator · personalization context-builder · cache-aware message service · repositories (PR007) · context audit: `serializeContext()` snapshot · `findWithContext()` · `compareContextSnapshots()` (PR007.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|               | `modules/analytics` — deterministic metrics pipeline (sales metrics · attribution · snapshot builder) · materialized snapshots · lazy+refresh service · repositories · validators · deterministic sales seed (PR008)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|               | `modules/delivery` — core connector interface + Map factory · instagram & whatsapp OAuth/Cloud-API connectors · dispatcher + retry engine · webhook handlers · repositories · dto · validators (PR010)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Design System | `components/ui/design-system` — `colors.ts` · `spacing.ts` (8pt grid) · `tokens.ts` (Inter, 16px radius, elevation, motion) · `theme.ts` (semantic roles + Tailwind recipes + chart theme) (PR010.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| UI            | **Enterprise dark premium** — glass AppShell · grouped collapsible Sidebar (6 módulos) + workspace switcher · Header com busca global ⌘K, notificações, status TikTok, Nova Campanha e avatar · Glass Dashboard (6 KPIs + 4 gráficos Recharts) · Premium Login (2 colunas) (PR010.1) · **Error Boundaries com digest + Copiar ID · skeletons de loading · empty states com CTA · telas de convite/reset/solicitar acesso** (PR010.2) · **páginas terminais /invite/invalid e /invite/expired** (PR010.3) · **Signup premium em 2 colunas com validação em tempo real e erro sob cada campo · CTAs "Criar Conta"/"Fazer Login" na landing e no login · checklist de onboarding no dashboard** (PR010.4)                                                                                                                                               |
| Currency      | **BRL** (default across Product, Campaign, Sale) · money = integer cents · margin = basis points                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Auth          | NextAuth v5 (Prisma adapter **tenant-aware**, JWT) + **Credentials provider (email/senha)** + **Google SSO (opcional — botão oculto quando não configurado)** · **`middleware.ts`** protege as rotas privadas e redireciona para `/login?next=<path>` · convite e reset de senha (TTL 30 min) (PR010.2) · **InvitationMailer/ConsoleMailer · Google aceita GOOGLE_CLIENT_ID/SECRET ou AUTH_GOOGLE_ID/SECRET · APP_URL para links** (PR010.3) · **Self signup em `/signup`: Organization + User ADMIN + workspace + seed em uma transação, login automático · primeiro acesso Google provisiona o tenant via `createUser` do adapter · convite agora só adiciona alguém a um tenant existente** (PR010.4)                                                                                                                                             |
| RBAC          | ADMIN > MANAGER > MEMBER — products: ADMIN cria/edita/exclui · MANAGER edita · MEMBER somente leitura · **convites: ADMIN apenas; papel convidável limitado a MANAGER\|MEMBER** (PR010.2) · **o primeiro usuário de um tenant criado por self signup (ou pelo primeiro acesso Google) é sempre ADMIN; `role` nunca é aceito como entrada do cliente** (PR010.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Database      | PostgreSQL via Prisma (pg driver adapter, Rust-free client)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Migrations    | `…_init_multitenant` · `…_require_organization` · `…_product_intelligence_core` · `…_trend_hunter_ai` · `…_trend_source` · `…_creator_discovery_engine` · `…_outreach_ai_sales_pipeline` · `…_connector_framework` · `…_product_match_architecture` · `…_campaign_engine` · `…_ai_personalization_engine` · `…_ai_context_audit` · `…_analytics_attribution` · `…_tiktok_shop_connector` · `…_omnichannel_delivery` · `…_enterprise_authentication_ux` · `…_self_signup_first_tenant`                                                                                                                                                                                                                                                                                                                                                                |
| Tests         | Vitest — **2,632 unit tests** (RBAC, session, tenancy, passwords, pricing, slug, validators, filters, storage, trends, creators, outreach, connectors, matches, campaigns, AI personalization + AI context audit + analytics + TikTok Shop + omnichannel delivery + design-system tokens/contraste AA + navegação + dashboard read model + shell context + **middleware/redirect + sanitização de `next` + convites + reset de senha + visibilidade do Google + error boundary** — OpenAI/Meta/TikTok fully mocked, zero real network calls) (PR010.2) · **InvitationMailer · roteamento de erros do convite · aliases de env do Google** (PR010.3) · **validação do cadastro · provisionamento do primeiro tenant · signup service · signup action + login automático · primeiro acesso Google · onboarding · contratos de UI do signup** (PR010.4) |
| Deploy        | Render Blueprint (`render.yaml`) + GitHub Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Build/CI      | ✅ green (ci → validate → generate → lint → typecheck → test → build → format)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 2. Tech Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
Prisma ORM · PostgreSQL · NextAuth v5 · bcryptjs · Zod · React Hook Form ·
Lucide · **Recharts** (data-viz, lazy-loaded) · **Framer Motion** (micro-interações) ·
Vitest · Docker · ESLint · Prettier · Render.

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

| Model                             | Purpose                                                                                                                  | Tenant-scoped     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Organization                      | Tenant boundary                                                                                                          | — (is the tenant) |
| User                              | Team members + roles                                                                                                     | ✅ required FK    |
| Product                           | Catalog (BRL, stock, cost, margin)                                                                                       | ✅ required FK    |
| ProductMedia                      | Product images/videos (PR001)                                                                                            | ✅ required FK    |
| ProductVariant                    | Sellable variations + stock (PR001)                                                                                      | ✅ required FK    |
| ProductCost                       | Cost snapshots → margin (PR001)                                                                                          | ✅ required FK    |
| ProductMetric                     | Daily performance metrics (PR001)                                                                                        | ✅ required FK    |
| TrendSnapshot                     | Trend Hunter snapshots (PR002 + source PR002.1)                                                                          | ✅ required FK    |
| TrendKeyword                      | Keyword frequency (PR002)                                                                                                | ✅ required FK    |
| TrendCategory                     | Category score (PR002)                                                                                                   | ✅ required FK    |
| CreatorProfile                    | Creator CRM (PR003: source, niche, score, pipeline)                                                                      | ✅ required FK    |
| Campaign                          | Orchestration + audience strategy (BRL)                                                                                  | ✅ required FK    |
| Message                           | Conversations                                                                                                            | ↳ via relations   |
| Sale                              | Revenue records (BRL)                                                                                                    | ↳ via relations   |
| CampaignProduct                   | M:N join (campaign ⇄ product)                                                                                            | ↳ via campaign    |
| CreatorMetric                     | Daily creator metrics (PR003)                                                                                            | ✅ required FK    |
| CreatorTag                        | Creator labels (PR003)                                                                                                   | ✅ required FK    |
| ConnectorStatus                   | Per-platform connector state + counters (PR005)                                                                          | ✅ required FK    |
| ExternalContent                   | Imported external content + dedupe (PR005)                                                                               | ✅ required FK    |
| ProductMatch                      | Content ⇄ product correspondence + confidence (PR005.1)                                                                  | ✅ required FK    |
| CampaignAudience                  | Ranked creator/product recommendations (PR006)                                                                           | ✅ required FK    |
| CampaignRule                      | Campaign eligibility thresholds (PR006)                                                                                  | ✅ required FK    |
| CampaignCreator                   | M:N join (campaign ⇄ creator)                                                                                            | ↳ via campaign    |
| AIGeneratedMessage                | Versioned OpenAI-generated commercial content (PR007) + contextSnapshot audit column (PR007.1, nullable for retrocompat) | ✅ required FK    |
| AnalyticsSnapshot                 | Materialized deterministic metrics snapshot per tenant+period (PR008) — unique (organizationId, from, to)                | ✅ required FK    |
| Account/Session/VerificationToken | NextAuth adapter                                                                                                         | —                 |

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

### AI Personalization Engine (PR007)

`modules/ai` — integrates OpenAI to generate personalized commercial
content (title, message, hashtags, cta) per creator/product/campaign/trend
context. **Generation and versioning ONLY — this module never sends a
message anywhere.** Delivery remains the Outreach AI outbox's job (PR004),
which is untouched.

- **OpenAI Responses API — no SDK.** `openai/client.ts` speaks
  `POST https://api.openai.com/v1/responses` directly over `fetch` (no
  provider SDK, matching the codebase's "no SDK" policy for external
  integrations). It is the single call site for the OpenAI endpoint —
  reads `OPENAI_API_KEY` from `process.env` and is marked `import
"server-only"`, so pulling it into a Client Component's module graph
  fails the Next.js **build**, not just a runtime check. A structured JSON
  Schema (`AI_MESSAGE_OUTPUT_SCHEMA`) is attached to every call so the
  model's response is constrained to `{ title, message, hashtags, cta }`.
- **5 versioned prompts — one per tone.** `openai/prompts.ts` defines
  exactly `FRIENDLY · PREMIUM · LUXURY · STREET · FITNESS` (mirrors the
  `AiMessageTone` Prisma enum). Each carries an explicit semantic version
  (`friendly@1.0.0`, …) that is persisted and is part of the cache key —
  bumping a template's copy requires bumping its version, or stale cached
  content would silently keep serving the old wording. Every instruction
  explicitly states "nunca envie a mensagem — apenas gere o conteúdo."
- **Context builder** (`personalization/context-builder.ts`, pure): takes
  plain Creator/Product/Campaign/Trend inputs (no Prisma type coupling)
  and returns a structured `PersonalizationContext`, plus a deterministic
  `serializeContextForHash()` used by the cache-key hash.
- **Generator** (`openai/generator.ts`): `generatePersonalizedMessage()`
  calls the OpenAI client with the tone's instructions + the serialized
  context, validates/parses the model's JSON reply
  (`parseGeneratedContent`, throws `GeneratedContentValidationError` on a
  malformed shape), and returns `{ content: { title, message, hashtags,
cta }, promptVersion, model, temperature, inputTokens, outputTokens }`.
- **Cache contract (never regenerate for an identical context):**
  `message.service.ts#buildContextHash()` computes a SHA-256 digest over
  `tone + creator + product + campaign + promptVersion`.
  `AIGeneratedMessage` has a UNIQUE `(organizationId, contextHash)` index —
  a cache hit returns the previously persisted row and OpenAI is never
  called again for it (`cached: true` in the service/action result).
- **Repository** (`repositories/ai-message.repository.ts`):
  `findByContextHash` · `create` · `findById` · `list` · `kpis`.
  `organizationId` is ALWAYS the first argument, built through
  `tenantWhere`/`scopedWhere`. Factory (`createAiMessageRepository(db)`)
  keeps it unit-testable without a database.
- **Server actions only.** `app/dashboard/ai/actions.ts#generateAiMessageAction`
  is the **only** entry point into the AI Personalization Engine reachable
  from the client — `requireManager()`-gated, resolves creator/product/
  campaign/trend from the tenant, lazily imports `message.service.ts` (so
  the OpenAI-touching module graph is only ever loaded server-side), and
  returns a uniform `AiActionResult`. The API key never reaches the
  browser; no message is ever dispatched.
- **Build-time enforcement.** Beyond `server-only`, `eslint.config.mjs`
  adds a `no-restricted-imports` rule scoped to `components/**/*.{ts,tsx}`
  that forbids importing `modules/ai/openai/client` or
  `modules/ai/openai/generator` — even transitively — from a Client
  Component. `modules/ai/openai/prompts.ts` (pure data/types, no secret,
  no network call) is exempt and safely shared with the UI.
- **Dashboard** `/dashboard/ai`: KPIs (mensagens geradas · tokens
  consumidos · custo estimado · prompt version), a generation form
  (creator/produto/campanha/tom), and a full content preview (title,
  message, hashtags, cta) per generated row.
- **Tests mock OpenAI entirely** — `fetch` is stubbed in
  `tests/ai-openai-client.test.ts`; `callOpenAiResponses` is mocked in
  `tests/ai-generator.test.ts`; the generator itself is mocked in
  `tests/ai-message-service.test.ts`. **Zero real network calls** anywhere
  in the suite.

```
modules/
└── ai/
    ├── openai/           client.ts (Responses API, server-only) ·
    │                     prompts.ts (5 versioned tones, pure) ·
    │                     generator.ts (server-only) · pricing.ts (dashboard estimate)
    ├── personalization/  context-builder.ts (pure: buildPersonalizationContext ·
    │                     serializeContextForHash · serializeContext [PR007.1] ·
    │                     readContextSnapshot [PR007.1]) ·
    │                     message.service.ts (cache + orchestration)
    ├── audit/            context-diff.ts (PR007.1 — pure compareContextSnapshots)
    ├── repositories/     ai-message.repository.ts — organizationId is ALWAYS the 1st arg
    │                     (findByContextHash · create · findById · findWithContext [PR007.1]
    │                     · list · kpis)
    └── validators/       generate-message.validator.ts (Zod)
```

### AI Context Audit (PR007.1)

Retrocompatible hotfix over PR007 — **no PR007 behavior changed**: the
Responses API client, versioned prompts, cache contract and dashboard
behave exactly as before; only audit capabilities were added.

- **Context Snapshot.** `AIGeneratedMessage.contextSnapshot` (new NULLABLE
  `JSONB` column, purely additive migration `20260925120000_ai_context_audit`)
  persists the full structured context used for each generation —
  `creator {id,name,handle,niche,score}` · `product {id,name,margin}` ·
  `campaign {id,name}` · `trend {keyword,score} | null` — built by the new
  pure `serializeContext()` in `personalization/context-builder.ts`
  (`creator.score` ← `CreatorProfile.creatorScore`, `product.margin` ←
  `Product.marginBps` basis points, missing optionals → `null`, frozen key
  order). Nullable only for retrocompat: pre-PR007.1 rows carry `NULL`.
  **Cache invariant: the snapshot is never hashed** — `contextHash` is
  still computed from `serializeContextForHash()` exactly as in PR007, and
  `score`/`margin` never enter the prompt context either, so cache hits
  are identical across the hotfix (pinned by tests).
- **Prompt Audit.** Combined with PR007's per-row `promptVersion`,
  `model`, `temperature`, `inputTokens`/`outputTokens` and `contextHash`,
  each message now answers _"which exact context + prompt version +
  sampling parameters produced this content?"_. Served tenant-scoped by
  the new repository method `findWithContext(organizationId, id)` (message
  - snapshot + creator/product/campaign relations as legacy fallback).
- **Context Diff.** `modules/ai/audit/context-diff.ts#compareContextSnapshots(a, b)`
  — pure, dependency-free recursive walker returning deterministic
  dotted-path diffs (`creator.score` 82 → 91 · `product.margin` 3550 →
  3990 · `trend.keyword` "streetwear" → "y2k") with sorted-key ordering,
  missing-key (`undefined`) and null-vs-value semantics.
- **Dashboard "Ver contexto".** `/dashboard/ai` rows gain a _Ver contexto_
  button opening a read-only modal (`components/ai/context-audit-modal.tsx`):
  Creator · Produto · Campanha · Trend (snapshot-first) + Prompt Version ·
  Model · Temperature · Tokens · Context Hash + the formatted read-only
  JSON snapshot. Fed lazily by the new read-only server action
  `getAiMessageContextAction` (`requireUser`/`requireOrganization` — every
  role that can view the page; generation remains MANAGER-only). The rest
  of the dashboard is untouched.

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

| Migration                                   | Purpose                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260922000000_init_multitenant`           | Initial schema (nullable `organizationId`)                                                                                                                                                                                                                                   |
| `20260922120000_require_organization`       | Promotes `organizationId` to `NOT NULL` on 4 models                                                                                                                                                                                                                          |
| `20260922180000_product_intelligence_core`  | PR001: 4 new product tables, stock/cost/margin columns, tenant-scoped slug/SKU uniqueness, dashboard indexes                                                                                                                                                                 |
| `20260922230000_trend_hunter_ai`            | PR002: TrendSnapshot, TrendKeyword, TrendCategory — all tenant-required FKs, tenant-scoped uniqueness on keyword/category, dashboard indexes                                                                                                                                 |
| `20260923050000_trend_source`               | PR002.1: `TrendSource` enum + `TrendSnapshot.source` (`NOT NULL DEFAULT 'MOCK'`, purely additive — no existing row touched) + `(organizationId, source)` index                                                                                                               |
| `20260923120000_creator_discovery_engine`   | PR003: `Creator` → `CreatorProfile` (data preserved), `CreatorSource`, CRM columns, `CreatorMetric`, `CreatorTag`, tenant-scoped uniques                                                                                                                                     |
| `20260922194600_outreach_ai_sales_pipeline` | PR004: `OutreachStatus`, `TemplateType`, `OutreachMessage`, `MessageTemplate`, `FollowUpSequence` — all tenant-required FKs                                                                                                                                                  |
| `20260923180000_connector_framework`        | PR005: `ConnectorPlatform`/`ConnectorState`/`ExternalContentType`/`ExternalContentStatus` enums + `ConnectorStatus` + `ExternalContent` — purely ADDITIVE, dedupe unique `(organizationId, platform, externalId)`, no credential column by design                            |
| `20260923220000_product_match_architecture` | PR005.1: `MatchSource` enum + `ProductMatch` (content ⇄ product link, 0–1 confidence) — purely ADDITIVE, unique `(externalContentId, productId)`, Cascade on organization/content/product                                                                                    |
| `20260924200000_campaign_engine`            | PR006: `CampaignAudience`, `CampaignRule`, `CampaignCreator` join — deterministic AI Matching + ROI Engine support, all tenant-required FKs                                                                                                                                  |
| `20260925000000_ai_personalization_engine`  | PR007: `AiMessageTone` enum + `AIGeneratedMessage` (creator/product/campaign context, token usage, versioned prompt) — purely ADDITIVE, unique `(organizationId, contextHash)` cache key, Cascade on organization/creatorProfile/product/campaign, `SET NULL` on creatorUser |
| `20260925120000_ai_context_audit`           | PR007.1: `AIGeneratedMessage.contextSnapshot JSONB NULL` — purely ADDITIVE single-column migration; cache key unchanged; rows pre-PR007.1 keep NULL                                                                                                                          |
| `20260925180000_analytics_attribution`      | PR008: `AnalyticsSnapshot` (tenant + period key + versioned metrics JSON + computedAt) — purely ADDITIVE, unique `(organizationId, from, to)`, Cascade on organization; purely derived data (recomputable)                                                                   |

The PR000.2 migration is **safe and non-inventive**: it never fabricates an
Organization and never guesses an owner. A `DO $$ … $$` guard counts tenant-less
rows in `User`/`Product`/`CreatorProfile`/`Campaign` and aborts with an actionable
`RAISE EXCEPTION` listing the offending tables, so an operator assigns the
correct tenant before re-running. On a fresh database the guard is a no-op.

---

## 7. Routes

| Route                                | Status | Notes                                                                                                                                                                                            |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                  | ✅     | Landing                                                                                                                                                                                          |
| `/login`                             | ✅     | RHF + Zod → `loginAction` server action → Credentials · Google condicional (PR010.2 · PR010.3 aliases)                                                                                           |
| `/signup`                            | ✅     | PR010.4 §2–§4 — cadastro público em 2 colunas → Organization + User ADMIN + workspace + seed → login automático → `/dashboard` · Google opcional                                                 |
| ~~`/request-access`~~                | ❌     | PR010.4 §1 — removida junto com `AccessRequest`; o caminho público agora é `/signup`                                                                                                             |
| ~~`/request-access/success`~~        | ❌     | PR010.4 §1 — removida                                                                                                                                                                            |
| `/invite/[token]`                    | ✅     | PR010.2 — preview do workspace/papel → definir senha → entrar automaticamente · PR010.3: rejeições redirecionam para as páginas terminais                                                        |
| `/invite/invalid`                    | ✅     | PR010.3 §10 — token inexistente, usado ou revogado                                                                                                                                               |
| `/invite/expired`                    | ✅     | PR010.3 §10 — convite expirado (TTL 7 dias)                                                                                                                                                      |
| `/forgot-password` `/reset-password` | ✅     | PR010.2 — fluxo de reset por token (TTL 30 min), sem enumeração de usuários                                                                                                                      |
| ~~`/dashboard/settings/access`~~     | ❌     | PR010.4 §1 — fila de solicitações removida (não há mais solicitações a revisar)                                                                                                                  |
| `/dashboard`                         | ✅     | App shell, KPIs · **checklist de onboarding (PR010.4 §9) enquanto houver passo pendente e não dispensado**                                                                                       |
| `/dashboard/products`                | ✅     | PR001 — tabela paginada, busca, filtros (status/margem/preço/estoque), ordenação, KPIs                                                                                                           |
| `/dashboard/products/new`            | ✅     | PR001 — criação (ADMIN only)                                                                                                                                                                     |
| `/dashboard/products/[id]`           | ✅     | PR001 — detalhe/edição, mídia, variações, custos & margem                                                                                                                                        |
| `/dashboard/trends`                  | ✅     | PR002 — KPIs, tabela com busca/filtro/ordenação/paginação · filtro Origem (PR002.1)                                                                                                              |
| `/dashboard/creators`                | ✅     | PR003 — KPIs, tabela com busca/filtros/ordenação/paginação, Kanban do pipeline, descoberta (ADMIN)                                                                                               |
| `/dashboard/outreach`                | ✅     | PR004 — KPIs do outbox, workbench de geração/agendamento                                                                                                                                         |
| `/dashboard/connectors`              | ✅     | PR005 — KPIs (Importados/Duplicados/Falhas/Ativos), cards por conector, tabela de conteúdo externo                                                                                               |
| `/dashboard/matches`                 | ✅     | PR005.1 — KPIs (Importados/Automáticos/Pendentes/Confiança média), tabela Vídeo·Produto·Confidence·Origem·Status                                                                                 |
| `/dashboard/campaigns`               | ✅     | PR006 — recomendações de creators/produtos, score médio, ROI projetado, tabela de audiência                                                                                                      |
| `/dashboard/ai`                      | ✅     | PR007 — KPIs (mensagens geradas/tokens/custo estimado/prompt version), geração por tom, preview de conteúdo; PR007.1 — botão "Ver contexto" + modal de auditoria (snapshot JSON somente leitura) |
| `/dashboard/analytics`               | ✅     | PR008 — KPIs (receita PAID/margem/ticket/pipeline/ROI/uso de IA), período 7·30·90d, Recalcular (MANAGER+), tabelas de atribuição produto/creator/campanha com share%                             |
| `/settings`                          | ✅     | Profile + integrations status                                                                                                                                                                    |
| `/api/auth/*`                        | ✅     | NextAuth v5 handler (Credentials provider active)                                                                                                                                                |

Server actions:

- `app/login/actions.ts` → `loginAction()` (generic error, no leak).
- `app/signup/actions.ts` → `signupAction()` (PR010.4 §4 — Zod → provisiona o
  tenant → `signIn("credentials", { redirect: false })` → devolve
  `redirectTo` saneado; `role`/`organizationId`/`passwordHash` enviados pelo
  cliente são descartados pelo schema; erros voltam em `fieldErrors` por
  campo).
- `app/dashboard/onboarding-actions.ts` → `dismissOnboardingAction()`
  (PR010.4 §9 — sem payload; o tenant vem de `requireOrganization()`; grava
  `onboardingCompletedAt` de forma idempotente e revalida `/dashboard`).
- ~~`app/dashboard/settings/access/actions.ts`~~ — removida em PR010.4 §1
  junto com a fila de solicitações. `/settings` continua emitindo convites,
  agora através de `invitationDeliveryService.deliverInvitation()`.
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
- `app/dashboard/ai/actions.ts` → 2 actions (PR007 · PR007.1):
  `generateAiMessageAction` (gera ou reutiliza do cache uma mensagem
  personalizada para creator/produto/campanha/tom) — `requireManager()`
  (ADMIN+MANAGER; MEMBER é somente leitura), resolve o contexto sempre
  dentro do tenant do chamador, e é o **único** ponto de entrada para o
  motor de IA acessível a partir do cliente. Nunca envia nada — apenas
  gera e persiste conteúdo versionado.
  `getAiMessageContextAction` (PR007.1 — leitura do contexto auditado de
  uma mensagem: snapshot-first com fallback para os registros relacionados
  em linhas pré-PR007.1) — `requireUser()` + `requireOrganization()`
  (todo papel que já visualiza `/dashboard/ai`), read-only, nunca
  revalida path, sempre tenant-scoped via `findWithContext()`.

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

### AI Personalization RBAC (PR007)

| Ação                 | ADMIN | MANAGER | MEMBER               |
| -------------------- | ----- | ------- | -------------------- |
| Gerar mensagem (IA)  | ✅    | ✅      | ❌                   |
| Visualizar dashboard | ✅    | ✅      | ✅ (somente leitura) |

> Same asymmetric boundary as Matches/Outreach: content generation is
> `requireManager()` (ADMIN+MANAGER), MEMBER is read-only — pinned by
> `tests/ai-rbac.test.ts`.

Enforced twice: UI affordances hidden per role **and** re-asserted in every
server action (`requireAdmin`/`requireManager`).

---

## 8. Environment Variables

**Canonical contract (PR000.2 + PR010.3):**

| Variable          | Required | Purpose                                                                                                                           |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`     | yes      | NextAuth v5 JWT/session signing secret                                                                                            |
| `NEXTAUTH_URL`    | prod     | Canonical URL for NextAuth callbacks/redirects                                                                                    |
| `DATABASE_URL`    | yes      | PostgreSQL connection string (Prisma)                                                                                             |
| `AUTH_TRUST_HOST` | no       | Trust the proxy `Host` header (Render/Docker)                                                                                     |
| `APP_URL`         | no       | PR010.3 §12 — canonical PUBLIC base URL for human-facing links (invitation URLs); falls back to `NEXTAUTH_URL` (`lib/app-url.ts`) |

**Federated sign-in (PR010.2 §4 · PR010.3 §5/§12) — either complete pair:**

| Variable               | Required | Purpose                     |
| ---------------------- | -------- | --------------------------- |
| `AUTH_GOOGLE_ID`       | no       | Google OAuth client id      |
| `AUTH_GOOGLE_SECRET`   | no       | Google OAuth secret         |
| `GOOGLE_CLIENT_ID`     | no       | PR010.3 alias of the id     |
| `GOOGLE_CLIENT_SECRET` | no       | PR010.3 alias of the secret |

A pair counts only when BOTH variables are present and non-blank; mixing one
variable from each pair does not enable the provider. `resolveGoogleCredentials()`
(`lib/auth-providers.ts`) is the single resolver — the button and the provider
registration cannot drift. SERVER ONLY: the login page receives one boolean.

Optional: `NODE_ENV`. Local-only seed bootstrap: `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`.

> **History:** `APP_URL` and `AUTH_URL` were removed in PR000.2 (nothing read
> them). PR010.3 §12 **reintroduces `APP_URL`** with a narrower mandate —
> human-facing links only; NextAuth keeps `NEXTAUTH_URL` for callbacks.

Reserved (NOT implemented): TikTok, Analytics keys, `RESEND_API_KEY` (the
`InvitationMailer` factory is the only place that will read it, when the
Resend transport ships).

**PR007 adds one env var**, read only by `modules/ai/openai/client.ts`:

| Variable         | Required                     | Purpose                                                      |
| ---------------- | ---------------------------- | ------------------------------------------------------------ |
| `OPENAI_API_KEY` | only to actually call OpenAI | OpenAI Responses API key — server-only, never `NEXT_PUBLIC_` |

The dashboard, cache lookups, and the entire test suite work without it —
tests mock the OpenAI client entirely. `render.yaml` declares it
`sync: false` (set manually in the Render dashboard, never committed).

### Security boundary

`AUTH_SECRET`, `DATABASE_URL`, `OPENAI_API_KEY` and `passwordHash` are
**server-only** and are never passed to a client component:

- `lib/env.ts` is only imported server-side; no `NEXT_PUBLIC_` variable exists.
- `authorize()` strips `passwordHash` before returning; it never reaches the
  JWT or the session.
- `CurrentUser` (`lib/session.ts`) exposes only
  `id · email · name · image · role · organizationId` — asserted by a test.
- `modules/ai/openai/client.ts` reads `OPENAI_API_KEY` and is marked
  `import "server-only"`; `eslint.config.mjs` additionally forbids any
  `components/**` file from importing it or `openai/generator.ts` (even
  transitively) — enforced at both lint time and Next.js build time.

---

## 9. Tests

`npm test` (Vitest, `tests/`) — **2,276 unit tests** (127 files), no database
required:

| File                                                                                                                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/rbac.test.ts`                                                                                                                                                         | `hasRole`, `isAdmin`, `isManager`, `assertRole`, full hierarchy matrix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `tests/session.test.ts`                                                                                                                                                      | `getCurrentUser`, `getCurrentOrganization`, `requireUser`, `requireOrganization`, `requireRole`, `requireAdmin`, `requireManager`, no-secret-leak assertion                                                                                                                                                                                                                                                                                                                                                                                               |
| `tests/tenant.test.ts`                                                                                                                                                       | `tenantWhere`, `scopedWhere`, `assertSameTenant`, cross-tenant isolation (a caller-supplied `organizationId` cannot override the scope)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `tests/password.test.ts`                                                                                                                                                     | bcrypt digest shape, salting, verification, no plaintext                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tests/pricing.test.ts`                                                                                                                                                      | PR001 — `totalCostCents`, `profitCents`, `marginBps` (rounding, zero price, negative margin), display helpers                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `tests/slug.test.ts`                                                                                                                                                         | PR001 — `baseSlug` (accents, fallback, length cap), `resolveUniqueSlug` (`-2`/`-3` collision handling, max length)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/product-validators.test.ts`                                                                                                                                           | PR001 — every Zod schema incl. hostile inputs (client-supplied `organizationId` is stripped; hostile sort fields fall back)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `tests/product-list-where.test.ts`                                                                                                                                           | PR001 — dashboard filter builder always injects the tenant scope; throws without one                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tests/products-rbac.test.ts`                                                                                                                                                | PR001 — products RBAC matrix (ADMIN cria/edita/exclui · MANAGER edita · MEMBER leitura)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `tests/media-storage.test.ts`                                                                                                                                                | PR001 — upload policy (mime allowlist, 10 MB cap) + placeholder provider contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tests/trend-scorer.test.ts`                                                                                                                                                 | PR002 — score engine: weights (30/20/15/20/15), normalization to 0–100, clamping, rounding, guard errors                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tests/trend-collector.test.ts`                                                                                                                                              | PR002 — mock collector: exactly 30 valid unique signals, 5 categories, scores 60–98, deterministic + defensive copies (+ PR002.1 `collect()` alias)                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/trend-validators.test.ts`                                                                                                                                             | PR002 — Zod schemas (signal/snapshot/list query) incl. hostile inputs + `keywordSlug`/`normalizeKeyword` (accents, fallback, length cap)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tests/trend-repository.test.ts`                                                                                                                                             | PR002 — repository against an in-memory fake Prisma: tenant always injected, blank tenant throws before ANY db call, cross-tenant invisibility, filters                                                                                                                                                                                                                                                                                                                                                                                                   |
| `tests/trend-scheduler.test.ts`                                                                                                                                              | PR002 — `collect-daily-trends` job (collect → score → validate → persist → aggregate), failure handling, manual-only contract (+ PR002.1 multi-source)                                                                                                                                                                                                                                                                                                                                                                                                    |
| `tests/trend-source.test.ts`                                                                                                                                                 | PR002.1 — `TrendSource` enum ↔ `TREND_SOURCES` sync, labels, MOCK default, Zod source schemas (accept/reject/defaults), URL-state `?source=`                                                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/collector-factory.test.ts`                                                                                                                                            | PR002.1 — `getCollector()` mapping per source, placeholder collectors throw "Not implemented", MANUAL/unknown throw, singleton cache, no-switch architecture                                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/trends-rbac.test.ts`                                                                                                                                                  | PR002 — trends RBAC matrix (ADMIN coleta/cria · MANAGER visualiza · MEMBER leitura)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tests/trend-dto.test.ts`                                                                                                                                                    | PR002 — DTO mappers: ISO serialization across the RSC boundary, score computed engine-side                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tests/connector-platform.test.ts`                                                                                                                                           | PR005 — the four connector enums ↔ their client-safe mirrors ↔ the Zod schemas (23 tests): labels, MOCK default, placeholder list, `isConnectorActive` KPI predicate, type guards                                                                                                                                                                                                                                                                                                                                                                         |
| `tests/connector-factory.test.ts`                                                                                                                                            | PR005 — `getConnector()` mapping per platform, singleton cache, registry helpers, unregistered platform throws `ConnectorNotRegisteredError`, placeholders throw on `fetchContent()` but answer `testConnection()` calmly (18 tests)                                                                                                                                                                                                                                                                                                                      |
| `tests/connector-mock.test.ts`                                                                                                                                               | PR005 — the mock adapter: 36 unique + 4 deliberate duplicates, type distribution, determinism (identical across runs), defensive copies, `limit`/`since`/`type` options, zero network access (17 tests)                                                                                                                                                                                                                                                                                                                                                   |
| `tests/connector-repository.test.ts`                                                                                                                                         | PR005 — repository against an in-memory fake Prisma: tenant always injected, blank tenant throws before ANY db call, cross-tenant invisibility, tenant-scoped dedupe, status lifecycle, counter accumulation, the four KPIs (20 tests)                                                                                                                                                                                                                                                                                                                    |
| `tests/connector-sync.test.ts`                                                                                                                                               | PR005 — the `sync-connector` job: import/dedupe/failure paths, counters, state transitions, placeholder handling (recorded ERROR, never a crash), `AuthorizationError` re-thrown, manual-only contract (22 tests)                                                                                                                                                                                                                                                                                                                                         |
| `tests/connector-dto.test.ts`                                                                                                                                                | PR005 — DTO mappers (ISO serialization, no tenant/raw leak, never-synced platform renders IDLE) + every validator incl. hostile inputs and malformed URL state (28 tests)                                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/connectors-rbac.test.ts`                                                                                                                                              | PR005 — connectors RBAC matrix: every write is ADMIN-only; MANAGER's powers elsewhere do not leak into connector infrastructure (6 tests)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/match-scorer.test.ts`                                                                                                                                                 | PR005.1 — rule weights (40/25/20/15 = 100) + `calculateMatchConfidence`: spec examples (0.98/0.76/0.52), clamping (never above 1, never below 0), 2-decimal rounding, hostile input collapses to 0 (17 tests)                                                                                                                                                                                                                                                                                                                                             |
| `tests/match-matcher.test.ts`                                                                                                                                                | PR005.1 — matcher engine: each rule fires alone and combined (full 1.00), normalization (accents/case/hyphens), whole-word strictness, derived categories, determinism, unique pairs, confidence-desc order, Prisma-row compatibility (29 tests)                                                                                                                                                                                                                                                                                                          |
| `tests/product-match-repository.test.ts`                                                                                                                                     | PR005.1 — repository against an in-memory fake Prisma: tenant always injected, blank tenant throws before ANY db call, cross-tenant invisibility, FK ownership on create, approve→MANUAL+1.00, KPIs (22 tests)                                                                                                                                                                                                                                                                                                                                            |
| `tests/product-match-dto.test.ts`                                                                                                                                            | PR005.1 — enum↔mirror sync, Zod schemas (confidence 0–1 bounds, rounding, hostile inputs), list-query safe defaults, DTO mappers (ISO dates, status derivation, pending backlog) (32 tests)                                                                                                                                                                                                                                                                                                                                                               |
| `tests/matches-rbac.test.ts`                                                                                                                                                 | PR005.1 — matches RBAC matrix: ADMIN+MANAGER write, MEMBER read-only, every guard maps to `requireManager()`, asymmetric boundary vs connectors pinned (8 tests)                                                                                                                                                                                                                                                                                                                                                                                          |
| `tests/campaign-matcher.test.ts`, `tests/campaign-scorer.test.ts`, `tests/campaign-roi.test.ts`, `tests/campaign-audience-repository.test.ts`, `tests/campaign-rbac.test.ts` | PR006 — deterministic AI Matching (score weights, recommendation ranking), ROI Engine (revenue/margin/commission/freight/profit projections), audience repository (tenant-scoped), RBAC matrix                                                                                                                                                                                                                                                                                                                                                            |
| `tests/ai-prompts.test.ts`                                                                                                                                                   | PR007 — the 5-tone prompt catalog: `AI_MESSAGE_TONES`, versioned `getPromptDefinition`/`listPromptDefinitions`, the required JSON output schema, `buildPromptInput()` content assembly, "never send" contract asserted in every instruction                                                                                                                                                                                                                                                                                                               |
| `tests/ai-context-builder.test.ts`                                                                                                                                           | PR007 — `buildPersonalizationContext()` field mapping + defaults, `serializeContextForHash()` determinism, sensitivity to every context field, stable across key ordering · PR007.1 — `serializeContext()` mandatory fields/frozen shape/null semantics, `readContextSnapshot()` structural guard, audit fields never reach the hash                                                                                                                                                                                                                      |
| `tests/ai-context-diff.test.ts`                                                                                                                                              | PR007.1 — `compareContextSnapshots()`: leaf/nested/array diffs, dotted paths (`creator.score` · `product.margin` · `trend.keyword`), missing-key `undefined` semantics, null-vs-value, trend null↔object, type changes, sorted-key determinism, no input mutation                                                                                                                                                                                                                                                                                         |
| `tests/ai-openai-client.test.ts`                                                                                                                                             | PR007 — `callOpenAiResponses()` against a **fully mocked `fetch`**: endpoint/auth header/body shape, `json_schema` structured output, `OpenAiConfigurationError`/`OpenAiRequestError`, `extractOutputText()` payload-shape fallback. Zero real network calls.                                                                                                                                                                                                                                                                                             |
| `tests/ai-generator.test.ts`                                                                                                                                                 | PR007 — `generatePersonalizedMessage()` with the OpenAI client mocked: per-tone prompt version resolution, `parseGeneratedContent()` strict shape validation (rejects malformed/partial JSON), `GeneratedContentValidationError`                                                                                                                                                                                                                                                                                                                          |
| `tests/ai-message-repository.test.ts`                                                                                                                                        | PR007 — repository against an in-memory fake Prisma: tenant always injected, cache lookup by `(organizationId, contextHash)` never leaks across tenants, list/filter by tone, aggregate KPIs · PR007.1 — `contextSnapshot` persisted on create, `findWithContext()` tenant-scoped incl. legacy NULL snapshot                                                                                                                                                                                                                                              |
| `tests/ai-message-service.test.ts`                                                                                                                                           | PR007 — **cache contract**: identical (creator+product+campaign+tone) context never calls OpenAI twice; tone/product changes force regeneration; tenant isolation; `buildContextHash()` determinism (sha256, tone-sensitive) · PR007.1 — snapshot persisted via `serializeContext()`, cache hit keeps stored snapshot, **cache invariance**: `contextHash` identical with/without audit-only fields                                                                                                                                                       |
| `tests/ai-context-audit-action.test.ts`                                                                                                                                      | PR007.1 — `getAiMessageContextAction()` with session/repository mocked: auth/org guards, tenant-scoped lookup, snapshot-first payload, legacy fallback (NULL snapshot), read-only (no `revalidatePath`)                                                                                                                                                                                                                                                                                                                                                   |
| `tests/ai-dashboard-actions.test.ts`                                                                                                                                         | PR007 — `generateAiMessageAction()` with session/prisma/service mocked: RBAC rejection, Zod validation, tenant-scoped lookups, trend pass-through, `revalidatePath` only on success, cached-result passthrough                                                                                                                                                                                                                                                                                                                                            |
| `tests/ai-validators.test.ts`                                                                                                                                                | PR007 — `generateAiMessageSchema`/`aiMessageListSchema` Zod schemas: required fields, the 5 allowed tones, pagination coercion/bounds                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tests/ai-pricing.test.ts`                                                                                                                                                   | PR007 — dashboard-only cost estimator: linear token scaling, per-model rates, unknown-model fallback, currency formatting                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/ai-rbac.test.ts`                                                                                                                                                      | PR007 — AI dashboard RBAC matrix: ADMIN+MANAGER generate, MEMBER read-only, every guard maps to `requireManager()`                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/ai-index.test.ts`                                                                                                                                                     | PR007 — the public `modules/ai` surface exposes prompts/context-builder/validators but **never** re-exports `callOpenAiResponses`/`generatePersonalizedMessage` (server-only boundary asserted from the test side too)                                                                                                                                                                                                                                                                                                                                    |
| `tests/analytics-sales-metrics.test.ts`                                                                                                                                      | PR008 — `computeSalesTotals()`: convenção revenue=PAID, COGS × qty, margem/ROI bps, ticket médio, custo desconhecido flagged, status desconhecidos ignorados, zero-safe                                                                                                                                                                                                                                                                                                                                                                                   |
| `tests/analytics-attribution.test.ts`                                                                                                                                        | PR008 — `attributeRevenue()`: buckets por dimensão, share bps soma ~100%, bucket sintético _Sem atribuição_ para SetNull, ordenação determinística (revenue desc · label · key), NaN-safe                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/analytics-snapshot-builder.test.ts`                                                                                                                                   | PR008 — payload versionado + byte-identical p/ mesmas linhas, custo de IA por modelo, período half-open UTC, guard de versão do leitor                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `tests/analytics-repository.test.ts`                                                                                                                                         | PR008 — repository c/ fake Prisma: escopo tenant relacional no Sale + período half-open, aggregate de IA por tom/modelo, unique key de snapshot, upsert sem duplicar                                                                                                                                                                                                                                                                                                                                                                                      |
| `tests/analytics-service.test.ts`                                                                                                                                            | PR008 — pipeline lazy (computa+persiste no miss), fonte snapshot sem recomputar, stale via max(sale.updatedAt), refresh força recomputação, período por dias, determinismo com clock injetável                                                                                                                                                                                                                                                                                                                                                            |
| `tests/analytics-validators.test.ts`                                                                                                                                         | PR008 — `days` coerced/bounded (1–365, default 30), payloads hostis rejeitados                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/analytics-actions.test.ts`                                                                                                                                            | PR008 — `refreshAnalyticsAction()`: RBAC, Zod, tenant da sessão (nunca do cliente), `revalidatePath` só em sucesso                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/analytics-rbac.test.ts`                                                                                                                                               | PR008 — matriz RBAC: MANAGER+ (ADMIN incluído) na página/ações, MEMBER negado, hierarquia monotônica                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tests/analytics-seed-sales.test.ts`                                                                                                                                         | PR008 — seed determinístico: 40 vendas, distribuição 28/5/4/3, links reais, amountCents = price×qty, janela de 30 dias, referências únicas                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tests/design-system-tokens.test.ts`                                                                                                                                         | PR010.1 — design system: 8pt grid integrity, 16px signature radius, Inter type scale ↔ role aliases, **computed WCAG contrast ratios** (body text AA, focus ring 3:1 on every surface step, status tones), motion duration/offset caps, z-index ordering                                                                                                                                                                                                                                                                                                  |
| `tests/navigation.test.ts`                                                                                                                                                   | PR010.1 — IA: exactly six module groups in order, every legacy route preserved, no duplicate route, groups ≤ 7 items, palette descriptions present, active-route resolution (dashboard root exact, nested detail pages, prefix-sibling rejection) · PR010.3: rota Acesso no grupo System, única na nav, sem sombrear o Dashboard                                                                                                                                                                                                                          |
| `tests/dashboard-overview.test.ts`                                                                                                                                           | PR010.1 — overview read model: tenant injected in EVERY query (incl. Sale's relational scope), blank tenant throws before any db call, analytics totals passed through verbatim, PAID-only revenue convention, gap-free zero-filled daily series, conversion without division by zero                                                                                                                                                                                                                                                                     |
| `tests/shell-context.test.ts`                                                                                                                                                | PR010.1 — shell boundary: tenant-scoped org/integration lookups, name fallbacks, TikTok health mapping, count-by-status never selects a token column, **explicit no-credential-leak assertion** on the serialized client payload                                                                                                                                                                                                                                                                                                                          |
| `tests/auth-routes.test.ts`                                                                                                                                                  | PR010.2 — sanitização de `next`: aceita só caminhos absolutos same-origin; rejeita `//host`, `/\host`, barra invertida, `scheme:`, caminhos relativos, caracteres de controle e `%0a/%0d/%09` (**verificados na string crua, antes do `trim()`**), e rotas de auth (anti-loop); `buildLoginUrl("/dashboard") === "/login?next=%2Fdashboard"`                                                                                                                                                                                                              |
| `tests/auth-middleware.test.ts`                                                                                                                                              | PR010.2 §2 — matriz de redirecionamento contra o `next/server` real (`getToken` mockado): 11 rotas protegidas → `/login?next=<path>` com querystring preservada, sessão válida passa, `/login` autenticado → destino saneado, `?next=` hostil ignorado, rotas públicas/webhooks nunca leem token, cookie `__Secure-` em https · PR010.3: `/dashboard/settings/access` protegido com destino preservado, páginas `/request-access/success` · `/invite/invalid` · `/invite/expired` nunca leem token, `APP_URL` https também seleciona o cookie `__Secure-` |
| `tests/auth-ux-contracts.test.ts`                                                                                                                                            | PR010.2 §1/§3/§4/§9/§10/§11/§13 — CTA do landing nunca aponta para `/dashboard` cru, Google sem controle `disabled` e sem credencial no bundle, campos e links do login, arquivos de loading e skeletons, empty states com CTA vs. "Limpar filtros", `requireAdmin()` em toda ação, enum de convite sem ADMIN, Framer Motion + `prefers-reduced-motion`, nenhum segredo em Client Component                                                                                                                                                               |
| `tests/auth-invitation.test.ts`                                                                                                                                              | PR010.2 §7 — fake Prisma: só o digest é persistido, convite é **uso único** (replay não cria segunda conta), papel/tenant vêm da linha e não do payload (tentativa de escalonamento a ADMIN rejeitada), reconvite rotaciona o token, expirado/revogado/aceito com razões tipadas, list/revoke escopados por tenant                                                                                                                                                                                                                                        |
| `tests/auth-error-boundary.test.ts`                                                                                                                                          | PR010.2 §8 — os quatro arquivos existem e são Client Components, botões Voltar/Recarregar/Copiar ID presentes, `reset()` preferido ao reload, `error.message` só fora de produção, stack nunca renderizada, `global-error` com `<html>`/`<body>` próprios, zero imports além do React e estilos inline                                                                                                                                                                                                                                                    |
| `tests/auth-tokens.test.ts`                                                                                                                                                  | PR010.2 §6/§7 — 32 bytes base64url únicos em 500 sorteios, digest SHA-256 nunca contém o token cru, comparação em tempo constante, TTL de reset de **exatamente 30 min** e convite de 7 dias, `isExpired()` trata a borda exata e a ausência de data como expirado                                                                                                                                                                                                                                                                                        |
| `tests/auth-password-reset.test.ts`                                                                                                                                          | PR010.2 §6 — **sem enumeração de usuários** (mesma forma de resposta, nada escrito para email desconhecido), só o digest persistido, novo token invalida os pendentes, uso único (replay não reescreve a senha), expirado não altera o hash                                                                                                                                                                                                                                                                                                               |

| `tests/auth-mailer.test.ts` | PR010.3 §9 — `InvitationMailer` interface + `ConsoleMailer`: mensagem renderizada (assunto, saudação com/sem nome, workspace, papel em pt-BR, TTL), log greppável com o link completo (o canal de entrega), recusa payload sem destinatário/URL, factory ignora `RESEND_API_KEY` até o transport existir |
| `tests/auth-invite-pages.test.ts` | PR010.3 §10 — o componente de página é executado direto: token expirado → redirect `/invite/expired`; inexistente/revogado/aceito/erro inesperado → `/invite/invalid` (com log server-side); token válido não redireciona; as três páginas existem, são públicas, sem formulário, com próximos passos |
| `tests/auth-google-visibility.test.ts` | PR010.3 §5/§12 — `resolveGoogleCredentials()`: par `GOOGLE_CLIENT_*` ou `AUTH_GOOGLE_*` (completo, jamais misturado), precedência do par nativo, valores aparados; `showGoogleProvider` espelha o resolver; contratos de fonte (auth.ts não lê env diretamente, botão nunca disabled, env.ts/.env.example documentam tudo) |
| `tests/auth-app-url.test.ts` | PR010.3 §12 — `resolveAppBaseUrl()`: `APP_URL` > `NEXTAUTH_URL` > `""`, barras finais aparadas, só origens http(s), valores em branco/não-http ignorados; `buildInviteUrl()` nunca produz URL protocolo-relativa e degrada para caminho relativo |
| `tests/signup-validation.test.ts` | PR010.4 §3/§8 — 82 casos sobre `signupSchema`: ordem dos campos, cada regra por campo com a mensagem exata em português, `normalizeWhatsapp`, confirmação de senha, aceite obrigatório, `role`/`organizationId` descartados, e o contrato §8 (um erro por campo, nunca uma mensagem genérica, nenhum "Required" do Zod, todos os issues com `path`) |
| `tests/signup-tenant-provisioning.test.ts` | PR010.4 §4/§5/§9 — regras puras: slug com acentos/pontuação/emoji, palavras reservadas sufixadas (`login`, `signup`, `dashboard`…), colisões `-2`/`-3`/…, limite de comprimento; defaults BRL·pt-BR·America/Sao_Paulo; os quatro passos do onboarding e sua derivação a partir das contagens; nome e empresa inferidos do email, ignorando provedores de email gratuito |
| `tests/signup-service.test.ts` | PR010.4 §4/§5 — fake Prisma: provisionamento em uma transação (Organization + User **ADMIN** + defaults + seed de templates), senha sempre em bcrypt e nunca em claro, email duplicado → `EMAIL_TAKEN` no campo `email` **sem escrita parcial**, colisão de slug resolvida, primeiro acesso Google cria o tenant e o retorno cria/não-cria, usuário existente não é reprovisionado nem reelevado |
| `tests/signup-action.test.ts` | PR010.4 §4/§8 — a action: provisiona antes de autenticar, `signIn("credentials", { redirect: false })`, destino decidido pelo servidor (`https://evil.example`, `//host`, CRLF e rotas de auth colapsam para `/dashboard`), `fieldErrors` por campo, P2002 mapeado para o email, falha só do auto-login informa que a conta existe, `role`/`organizationId`/`passwordHash` do cliente descartados |
| `tests/signup-google-first-login.test.ts` | PR010.4 §5 — `createTenantAwareAdapter()` sobrescreve **apenas** `createUser` (o resto é o `PrismaAdapter` intacto, e é por isso que o NextAuth não quebra): email normalizado, tenant provisionado no primeiro acesso, id do banco vence o id gerado, email marcado como verificado, identidade sem email recusada sem escrever nada, usuário conhecido entra normalmente sem reelevação |
| `tests/signup-onboarding.test.ts` | PR010.4 §9 — os quatro passos na ordem do PR, progresso derivado das contagens ao vivo, visibilidade (novo → visível, tudo feito → oculto, dispensado → oculto mas com progresso correto), toda contagem escopada ao tenant, tenant ausente lança `AuthorizationError` antes de qualquer leitura, `dismiss()` idempotente que grava só `onboardingCompletedAt` |
| `tests/signup-ui-contracts.test.ts` | PR010.4 §2/§3/§6/§7/§8/§9 — contratos de fonte: layout premium em 2 colunas, os sete campos e a validação `onChange`, erro renderizado sob cada campo com `aria-invalid`/`aria-describedby`, "Revise os campos destacados" inexistente, "Criar conta" no login e "Criar Conta"/"Fazer Login" na landing, checklist no dashboard escopado ao tenant, nenhum segredo ou import de Prisma nos Client Components |

---

## 10. Not Implemented (interface only)

- TikTok API / scraping — `modules/integrations/tiktok`. The Trend
  Hunter's and the Creator Discovery's real sources both land here
  (behind their collectors).
- Automated **sending** of AI-generated or outreach messages — PR004's
  outbox never auto-sends, and PR007's AI Personalization Engine
  deliberately generates/versions content ONLY and never dispatches it;
  the CRM pipeline stops at ACTIVE.
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
- Analytics pipeline / cross-channel attribution — `modules/analytics` (PR008)

---

## 11. Changelog

### PR010.1 — Enterprise UI/UX Redesign (2026-09-23) — completed

**Scope guard:** UI/UX ONLY. Zero business rules, zero Prisma schema/migration
changes, zero API or route-handler changes. Every Server Action, RBAC gate and
tenant scope is untouched — the only server code added
(`lib/shell-context.ts`, `lib/dashboard-overview.ts`) _reads_ existing,
already-tenant-scoped data for presentation.

- **Design System** — `components/ui/design-system/`:
  - `colors.ts` — brand (indigo) + accent (violet) + 7-step dark surface ramp,
    alpha text ramp, semantic status tones, 6-colour categorical chart series,
    glass and gradient recipes. Every documented pair clears WCAG AA.
  - `spacing.ts` — strict **8pt grid** (only `0.5`/`1.5` half-steps sanctioned),
    canonical layout dimensions (sidebar 264/76, header 64, content 1600) and
    breakpoints incl. an `ultra` 1920 tier.
  - `tokens.ts` — **Inter** type scale with role aliases, **16px signature
    radius**, elevation/blur ladders, restrained motion (≤320ms) and the
    single z-index scale.
  - `theme.ts` — semantic roles + static Tailwind class recipes (`focusRing`,
    `glassSurface`, `cardSurface`, …), Framer Motion presets and the shared
    Recharts theme. Mirrored CSS-first in `styles/globals.css#@theme`.
- **Layout** — `AppShell` (glass chrome, 1600px content cap, skip link,
  `<main>` landmark), grouped `Sidebar`, `Header`, `PageHeader` (eyebrow +
  breadcrumbs). Glass cards, backdrop blur, subtle gradients and a restrained
  hover lift throughout.
- **Sidebar** — the flat PR000 list is regrouped into six modules
  (**Overview · Commerce · Creators · Campaigns · Integrations · System**) with
  animated per-group collapse, an icon-only 76px rail, per-item badges and a
  **workspace switcher**. Routes are unchanged — pure information architecture.
- **Header** — global search with **⌘K / Ctrl+K** command palette (searches the
  static nav manifest only; no data fetch, so nothing privileged can leak),
  notifications panel, **TikTok Shop status pill**, **Nova Campanha** CTA and
  the account menu.
- **Dashboard** — fully replaced. Six KPIs (**GMV · Pedidos · Creators · ROI ·
  Conversão · Receita**) and four **Recharts** visualisations (área, linha,
  barras horizontais ×2, rosca) plus quick actions and an operational summary.
  Every figure is READ from the PR008 analytics snapshot pipeline and from
  tenant-scoped counters — no metric is redefined.
- **Login** — premium two-column layout: brand/headline/benefits panel with
  gradient orbs on the left, glass authentication card on the right with
  email, password (show/hide), "esqueci minha senha" and a **documented,
  deliberately disabled** Google SSO button (NextAuth registers only the
  Credentials provider today). An **MFA step is reserved** in the markup; no
  MFA logic ships, since that is an auth-domain change.
- **Components** — `StatCard`, `ChartCard`, `EmptyState`, `SectionCard`,
  `QuickAction`, `ActivityTimeline`, `MetricBadge`, plus `Skeleton`, motion
  primitives and the chart family. The PR000 `KpiCard` became a thin shim over
  `StatCard`, so all nine existing module dashboards inherited the new visual
  language with no edits.
- **Micro-interactions** — Framer Motion fade / slide / stagger / pop, capped
  at 320ms and 16px of travel. Every primitive short-circuits under
  `prefers-reduced-motion` (rendering the final state, not a faster animation),
  reinforced globally in CSS.
- **Responsiveness** — verified at mobile, tablet, notebook and 1440+ desktop:
  off-canvas rail below `lg`, KPI grid 1→2→3→6 columns, charts stacking, and
  the 1600px content cap so ultrawide monitors don't stretch tables. The mobile
  drawer always opens at full labelled width, independently of the persisted
  desktop collapse preference.
- **Accessibility** — skip link, `<main>`/`<nav>`/`<section>` landmarks,
  `aria-current="page"`, labelled disclosures (`aria-expanded`/`-controls`),
  an ARIA combobox+listbox palette, `role="alert"` form errors,
  `aria-invalid`+`aria-describedby` fields, `<time dateTime>` and
  screen-reader chart summaries. Modal focus is contained and restored for the
  command palette and mobile navigation; the closed off-canvas rail is inert.
  The focus ring moved **brand-400 → brand-300** because brand-400 measured only
  2.92:1 against `surface-500` (WCAG 1.4.11
  requires 3:1) — a real contrast bug the token tests now prevent regressing.
- **Performance** — Recharts is behind `next/dynamic` (`ssr: false`) with
  same-height skeletons (no CLS), chart series are memoised, and the KPI/chart
  sections are wrapped in `Suspense`. First Load JS: **157 kB** on the chart-
  heavy `/dashboard`, **143 kB** on `/login`, **103 kB** shared.
- **Fixes found while building** — `QuickAction` was a Client Component
  receiving Lucide icon _references_ from Server Components, which throws
  "Functions cannot be passed directly to Client Components" at render; it is
  now a Server Component with a `QuickActionButton` sibling for client
  callbacks. Also fixed the long-standing CSS build warning by moving the
  `@import` of Inter above `@import "tailwindcss"`.
- **Tests:** suite grows from 1,742 to **1,818 tests** (+76) across four new
  files — `design-system-tokens` (8pt grid, radius, type scale, computed WCAG
  contrast ratios, motion caps, z-index ordering), `navigation` (six groups, no
  route lost or duplicated in the regrouping, active-route resolution),
  `dashboard-overview` (tenant isolation on every query, PAID-only revenue
  convention, gap-free daily series, no division by zero) and `shell-context`
  (tenant scoping + an explicit assertion that no credential crosses the
  client boundary).

### PR007 — AI Personalization Engine (2026-09-22) — completed

Integrates OpenAI to generate personalized commercial content (title,
message, hashtags, cta) per creator/product/campaign/trend context.
**Generation and versioning ONLY — no message is ever sent** by this PR;
delivery remains the Outreach AI outbox's job (PR004, untouched).

**Prisma**

- Enum `AiMessageTone` (FRIENDLY · PREMIUM · LUXURY · STREET · FITNESS) and
  model `AIGeneratedMessage` (`organizationId`/`creatorProfileId`/
  `productId`/`campaignId` required FKs with Cascade, `creatorUserId`
  optional with `SET NULL`, `tone`, `promptVersion`, `contextHash`,
  `model`, `temperature`, `inputTokens`/`outputTokens`, `content Json`).
  Unique `(organizationId, contextHash)` implements the "never regenerate
  an identical context" cache contract.
- Migration `20260925000000_ai_personalization_engine` — purely ADDITIVE,
  no existing table touched.

**OpenAI integration — no SDK, Responses API only**

- `modules/ai/openai/client.ts` — single call site for
  `POST https://api.openai.com/v1/responses` over `fetch`; reads
  `OPENAI_API_KEY` server-side; `import "server-only"` fails the build if
  ever imported by a Client Component. A JSON Schema constrains every
  response to `{ title, message, hashtags, cta }`.
- `modules/ai/openai/prompts.ts` — exactly 5 versioned prompts (one per
  tone), every instruction explicit that the message is never sent.
- `modules/ai/openai/generator.ts` — `generatePersonalizedMessage()`
  returns `{ title, message, hashtags, cta }` + token usage + prompt
  version; validates the model's JSON reply and throws
  `GeneratedContentValidationError` on a malformed shape.

**Personalization + cache**

- `modules/ai/personalization/context-builder.ts` — pure Creator/Product/
  Campaign/Trend → `PersonalizationContext` mapper, plus deterministic
  serialization for the cache-key hash.
- `modules/ai/personalization/message.service.ts` — `buildContextHash()`
  (sha256 of tone+creator+product+campaign+promptVersion) short-circuits
  on a cache hit **before** ever calling OpenAI; persists a new
  `AIGeneratedMessage` row only on a cache miss.
- `modules/ai/repositories/ai-message.repository.ts` —
  `findByContextHash` · `create` · `findById` · `list` · `kpis`;
  `organizationId` always first.

**Server actions / dashboard**

- `app/dashboard/analytics/actions.ts` → 1 action (PR008):
  `refreshAnalyticsAction` (recomputa e materializa o snapshot de
  métricas do período corrente do tenant) — `requireManager()` (receita e
  margem são dados sensíveis: MANAGER+, MEMBER é redirecionado da página
  para `/dashboard`), tenant sempre da sessão, dias coerced/bounded
  (1–365, default 30) via Zod, `revalidatePath` apenas em sucesso.
- `app/dashboard/ai/actions.ts#generateAiMessageAction` — the **only**
  entry point into the AI engine reachable from the client;
  `requireManager()`-gated, tenant-scoped context resolution, lazily
  imports the OpenAI-touching service so it's never bundled client-side.
- `/dashboard/ai` — KPIs (mensagens geradas · tokens consumidos · custo
  estimado · prompt version), generation form (creator/produto/campanha/
  tom), full content preview table.

**Build-time security enforcement**

- `server-only` on `client.ts`/`generator.ts` (Next.js build fails if
  imported client-side).
- `eslint.config.mjs` adds a `no-restricted-imports` rule scoped to
  `components/**/*.{ts,tsx}` forbidding `modules/ai/openai/client` and
  `modules/ai/openai/generator` imports — verified by manually inducing
  the violation (`no-restricted-imports` error fires as expected).
- `render.yaml` / `.env.example` document `OPENAI_API_KEY` as
  server-only, `sync: false`, never committed.

**Tests** — 133 new tests across 9 files (**1,150 total**, all green).
OpenAI is **fully mocked** (`fetch` stubbed, `callOpenAiResponses` and
`generatePersonalizedMessage` mocked at different layers) — zero real
network calls anywhere in the suite. Coverage: prompt catalog, context
builder, OpenAI client contract, generator validation, repository
(tenant isolation + cache lookup), service (cache-hit/miss, tenant
isolation, tone/product sensitivity), dashboard action (RBAC, Zod,
tenant scoping), validators, pricing estimator, RBAC matrix, and the
public module surface (asserts the OpenAI client/generator are NOT
re-exported).

**Verification sequence** (all green): `npm ci` → `prisma validate` →
`prisma generate` → `npm run lint` → `tsc --noEmit` → `vitest run`
(1,150/1,150) → `npm run build` (16 routes, including `/dashboard/ai`).

**Removed:** the orphaned PR000 stub `modules/integrations/ai/` (confirmed
unimported anywhere) — fully superseded by the real `modules/ai/` tree.

**Not performed:** no merge (PR left open for human audit, per the PR000
workflow).

**Delivery:** pushed on top of PR #12 (the session branch is fixed to
`arena/01a0cb96-brobond-ai-commerce`, so PR008 is stacked after
PR007.1's `4fabd2e`; the PR008-only diff is the final commit on the
branch — see the commit map pinned in the PR body). No merge performed.

### PR008 — Analytics & Attribution (2026-09-23) — completed

Deterministic analytics pipeline: revenue, margin and attribution metrics
materialized per tenant over half-open UTC periods — computed ONLY from
the tenant's own `Sale`/`Product`/`CreatorProfile`/`Campaign`/
`AIGeneratedMessage` rows. **No external tracking, no randomness, no
network, no new dependencies.**

**Prisma**

- Model `AnalyticsSnapshot` (`organizationId` required, Cascade; `from`/
  `to` half-open period; versioned `metrics Json`; `computedAt`), UNIQUE
  `(organizationId, from, to)` — one snapshot per tenant+period bucket;
  recomputation upserts, never duplicates. Migration
  `20260925180000_analytics_attribution` — purely ADDITIVE.
- Snapshots are purely derived data: deleting them loses nothing.

**Metrics pipeline (pure, Prisma-free)**

- `modules/analytics/metrics/sales-metrics.ts` — `computeSalesTotals()`
  (revenue = **PAID only**, mirroring `modules/sales`) + `ratioBps()`
  (division-by-zero-safe); COGS = `unitCostCents × qty`
  (`Product.currentCostCents`), unknown cost never reduces margin and is
  flagged via `revenueWithUnknownCostCents`.
- `modules/analytics/metrics/attribution.ts` — `attributeRevenue()`:
  every PAID sale in exactly one product/creator/campaign bucket;
  `SetNull` relations fall into the synthetic _"— Sem atribuição"_ bucket
  (share always sums to ~100%); deterministic ordering (revenue desc ·
  label asc · key asc); shares in integer bps.
- `modules/analytics/metrics/snapshot-builder.ts` —
  `buildAnalyticsMetrics()` versioned payload
  (`{version:1, period, totals, roiBps, attribution, ai}`), byte-identical
  for the same rows; AI usage costed per model via PR007's
  `estimateCostUsdCents`; `readAnalyticsMetrics()` version guard;
  UTC day-normalized `resolvePeriodDays(days, now)` (injectable clock).

**Data access / service**

- `repositories/analytics.repository.ts` — tenant scope ALWAYS first arg;
  `Sale` scoped via the relational filter, mirroring `modules/sales`
  (the "Sale gains organizationId" promotion remains tracked for a later
  PR); AI usage grouped by tone/model within tenant+period; snapshot
  find/upsert on the unique key.
- `services/analytics.service.ts` — lazy pipeline: snapshot-first;
  compute+persist on miss or version mismatch; `refresh()` forces
  recompute; stale detection via `max(Sale.updatedAt) > computedAt`.

**Dashboard `/dashboard/analytics` (MANAGER+)**

- KPIs: Receita (PAID) · Margem bruta (BRL + %) · Ticket médio · Pipeline
  pendente (reembolsos/canceladas) · ROI sobre COGS estimado · Uso de IA
  (custo USD estimado + tokens + mensagens).
- Period selector 7/30/90d (`days` coerced/bounded 1–365 server-side),
  **Recalcular** (`refreshAnalyticsAction`, `requireManager()`), three
  attribution tables (produto/creator/campanha) with CSS-only share bars.
- MEMBER is redirected to `/dashboard` (revenue/margin are
  business-sensitive).
- Sidebar: the pre-existing "Analytics" `planned` item is now real.

**Seed**

- 40 deterministic sales (28 PAID · 5 PENDING · 4 REFUNDED · 3 CANCELLED)
  over the last 30 days, round-robin linked to the workspace's real
  products/creators/campaigns (`modules/analytics/seed/sales-seed.ts`,
  pure generator). Idempotent: only when the workspace has no sales.

**Removed:** the orphaned PR000 stub `modules/analytics/analytics.interface.ts`
(confirmed unimported anywhere; superseded by the real module — same
precedent as PR007's removal of `modules/integrations/ai/`).

**Tests** — 82 new tests across 9 files (**1,292 total**, all green):
metrics (totals/attribution/snapshot builder), repository (tenant scope +
half-open period + upsert semantics), service (lazy/refresh/stale/
determinism), validators, action RBAC/Zod/revalidate, RBAC matrix, seed
determinism.

**Verification sequence** (all green): `npm ci` → `prisma validate` →
`prisma generate` → `npm run lint` → `tsc --noEmit` → `vitest run`
(1,292/1,292) → `npm run build` (17 routes, incl. `/dashboard/analytics`)
→ `prettier --check`.

**Not performed:** no merge (PR left open for human audit, per the PR000
workflow).

**Delivery:** pushed on top of PR #12 (the session branch is fixed to
`arena/01a0cb96-brobond-ai-commerce`, so PR008 is stacked after
PR007.1's `4fabd2e`; the PR008-only diff is the final commit on the
branch — see the commit map pinned in the PR body). No merge performed.

### PR007.1 — AI Context Audit Hotfix (2026-09-23) — completed

Retrocompatible hotfix stacked on PR007 (branch merged into this session's
branch; PR base `main`): complete audit trail of the context used by the
AI. **No PR007 behavior changed** — Responses API untouched, cache
contract untouched, dashboard untouched except the additive "Ver contexto"
button/modal. Fully backwards-compatible.

**Prisma**

- `AIGeneratedMessage.contextSnapshot Json?` — new NULLABLE column;
  migration `20260925120000_ai_context_audit` is purely ADDITIVE
  (single `ALTER TABLE … ADD COLUMN … JSONB`), safe on a populated DB.
  Nullable intentionally: pre-PR007.1 rows keep `NULL`.

**Context Builder**

- `serializeContext()` (pure) returns the JSON-STABLE audit snapshot with
  the mandatory fields `creator {id,name,handle,niche,score}` ·
  `product {id,name,margin}` · `campaign {id,name}` ·
  `trend {keyword,score} | null`, frozen key order, optionals → `null`.
- `readContextSnapshot()` — structural guard over unknown JSON read back
  from the DB (returns `null` for legacy/malformed payloads).
- `CreatorContextInput.score` / `ProductContextInput.margin` — optional,
  audit-only inputs mapped from `CreatorProfile.creatorScore` /
  `Product.marginBps`. **They never enter `buildPersonalizationContext()`
  nor `serializeContextForHash()`** — pinned by "cache invariance" tests.

**Message Service**

- Persists `contextSnapshot` on every cache-miss create; cache hits return
  the previously persisted row untouched. `contextHash` computation is
  byte-for-byte the PR007 one — the snapshot is never hashed.

**Repository**

- `findWithContext(organizationId, id)` — tenant-scoped fetch returning
  the message + `contextSnapshot` + creator/product/campaign relations
  (legacy fallback for NULL snapshots).
- `CreateAiMessageInput.contextSnapshot` required for every new row (the
  DB column stays nullable only for pre-PR007.1 rows).

**Dashboard**

- `/dashboard/ai` row action **Ver contexto** opens a read-only modal
  (`components/ai/context-audit-modal.tsx`): Creator · Produto · Campanha
  · Trend (snapshot-first) · Prompt Version · Model · Temperature · Tokens
  (in/out) · Context Hash · formatted read-only JSON snapshot.
- New read-only server action `getAiMessageContextAction` —
  `requireUser()`/`requireOrganization()` (any role that can already view
  the page; generation remains MANAGER-only), tenant-scoped via
  `findWithContext()`, never revalidates.

**Audit util**

- `modules/ai/audit/context-diff.ts#compareContextSnapshots(a, b)` — pure,
  dependency-free dotted-path diff (e.g. `creator.score` 82 → 91,
  `product.margin` 3550 → 3990, `trend.keyword` "streetwear" → "y2k"),
  deterministic sorted-key ordering, missing-key `undefined` semantics.

**Tests** — 60 new tests (**1,210 total**, all green): `serializeContext()`
(12) + `readContextSnapshot()` (5), context diff (21), service snapshot
persistence + cache invariance (6), repository `findWithContext()` +
snapshot persistence (7), context-audit action (9).

**Verification sequence** (all green): `npm ci` → `prisma validate` →
`prisma generate` → `npm run lint` → `tsc --noEmit` → `vitest run`
(1,210/1,210) → `npm run build` (16 routes, including `/dashboard/ai`) →
`prettier --check`.

**Not performed:** no merge (PR left open for human audit, per the PR000
workflow).

**Delivery:** pushed on top of PR #12 (the session branch is fixed to
`arena/01a0cb96-brobond-ai-commerce`, so PR008 is stacked after
PR007.1's `4fabd2e`; the PR008-only diff is the final commit on the
branch — see the commit map pinned in the PR body). No merge performed.

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

**Delivery:** pushed on top of PR #12 (the session branch is fixed to
`arena/01a0cb96-brobond-ai-commerce`, so PR008 is stacked after
PR007.1's `4fabd2e`; the PR008-only diff is the final commit on the
branch — see the commit map pinned in the PR body). No merge performed.

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

**Delivery:** pushed on top of PR #12 (the session branch is fixed to
`arena/01a0cb96-brobond-ai-commerce`, so PR008 is stacked after
PR007.1's `4fabd2e`; the PR008-only diff is the final commit on the
branch — see the commit map pinned in the PR body). No merge performed.

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
| PR005.1                            | Product Match Architecture        | ✅ done |
| PR006                              | Campaign Engine & AI Matching     | ✅ done |
| PR007                              | AI Personalization Engine         | ✅ done |
| PR007.1                            | AI Context Audit Hotfix           | ✅ done |
| PR008                              | Analytics & Attribution           | ✅ this |
| PR009                              | Billing & Multi-tenancy hardening | ⏭ next  |
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
| PR005.1 | Product Match Architecture        | ✅ done |
| PR006   | Campaign Engine & AI Matching     | ✅ done |
| PR007   | AI Personalization Engine         | ✅ done |
| PR007.1 | AI Context Audit Hotfix           | ✅ done |
| PR008   | Analytics & Attribution           | ✅ this |
| PR009   | Billing & Multi-tenancy hardening | ⏭ next  |

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
