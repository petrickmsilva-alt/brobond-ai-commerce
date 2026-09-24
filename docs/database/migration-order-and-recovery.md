# Migration order & failed-migration recovery

> **PR010.4.7 — HOTFIX** · `P3018` / `relation "CreatorProfile" does not exist`
> on `20260922194600_outreach_ai_sales_pipeline` (Render / PostgreSQL).

`prisma migrate deploy` replays `prisma/migrations/` **in lexicographic order of
the directory names**. A migration may therefore only touch relations that
already exist at that exact point in history. This document holds the audit of
that history, the fix, and the runbook for databases that are already stuck.

---

## 1. Audit — dependency tree of every migration

Replay order (top → bottom). `✚` marks the two migrations added by this hotfix.

| #   | Migration                                          | Creates (tables)                                                                                                                         | Renames                                      | Depends on (must already exist)                           |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| 1   | `20260922000000_init_multitenant`                  | Organization, User, Product, **Creator**, Campaign, Message, Sale, CampaignProduct, CampaignCreator, Account, Session, VerificationToken | —                                            | —                                                         |
| 2   | `20260922120000_require_organization`              | —                                                                                                                                        | —                                            | User, Product, Creator, Campaign                          |
| 3   | `20260922180000_product_intelligence_core`         | ProductMedia, ProductVariant, ProductCost, ProductMetric                                                                                 | —                                            | Product, Organization                                     |
| 4 ✚ | `20260922194500_creator_profile_forward_rename`    | —                                                                                                                                        | `Creator` → `CreatorProfile`                 | Creator                                                   |
| 5   | `20260922194600_outreach_ai_sales_pipeline`        | MessageTemplate, OutreachMessage, FollowUpSequence                                                                                       | —                                            | Organization, **CreatorProfile**, Product, Campaign, User |
| 6 ✚ | `20260922194700_creator_profile_restore_for_pr003` | —                                                                                                                                        | `CreatorProfile` → `Creator`                 | CreatorProfile                                            |
| 7   | `20260922230000_trend_hunter_ai`                   | TrendSnapshot, TrendKeyword, TrendCategory                                                                                               | —                                            | Organization                                              |
| 8   | `20260923050000_trend_source`                      | —                                                                                                                                        | —                                            | TrendSnapshot                                             |
| 9   | `20260923120000_creator_discovery_engine`          | CreatorMetric, CreatorTag                                                                                                                | `Creator` → `CreatorProfile` (**permanent**) | Creator, Organization                                     |
| 10  | `20260923180000_connector_framework`               | ConnectorStatus, ExternalContent                                                                                                         | —                                            | Organization                                              |
| 11  | `20260923220000_product_match_architecture`        | ProductMatch                                                                                                                             | —                                            | Organization, ExternalContent, Product                    |
| 12  | `20260924200000_campaign_engine`                   | CampaignAudience, CampaignRule                                                                                                           | —                                            | Organization, Campaign, CreatorProfile, Product           |
| 13  | `20260925000000_ai_personalization_engine`         | AIGeneratedMessage                                                                                                                       | —                                            | Organization, User, CreatorProfile, Product, Campaign     |
| 14  | `20260925120000_ai_context_audit`                  | —                                                                                                                                        | —                                            | AIGeneratedMessage                                        |
| 15  | `20260925180000_analytics_attribution`             | AnalyticsSnapshot                                                                                                                        | —                                            | Organization                                              |
| 16  | `20260926090000_tiktok_shop_connector`             | TikTokAccount, TikTokOAuthState, AuditLog                                                                                                | —                                            | Organization, Product                                     |
| 17  | `20260927090000_omnichannel_delivery`              | DeliveryAccount, DeliveryMessage, DeliveryOAuthState                                                                                     | —                                            | Organization                                              |
| 18  | `20260928090000_ai_ceo`                            | AIDecisionRun, AIDecision, DecisionEvidence, ExecutiveReport                                                                             | —                                            | Organization                                              |
| 19  | `20260928090000_enterprise_authentication_ux`      | AccessRequest, Invitation, PasswordResetToken                                                                                            | —                                            | Organization, User                                        |
| 20  | `20260929090000_self_signup_first_tenant`          | —                                                                                                                                        | —                                            | Organization                                              |

### The single defect

`20260922194600_outreach_ai_sales_pipeline` (PR004) ends with

```sql
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

but `CreatorProfile` does not exist yet: the table is created as **`Creator`**
by migration #1 and is only renamed to `CreatorProfile` by migration #9
(`20260923120000_creator_discovery_engine`, PR003 — authored _after_ PR004 but
with a _later_ timestamp). Every replay from an empty database therefore dies
at #5 with

```
Error: P3018 — A migration failed to apply.
  Migration name: 20260922194600_outreach_ai_sales_pipeline
  Database error: ERROR: relation "CreatorProfile" does not exist
```

and migrations #6 … #20 are never applied.

No other migration in the history has an ordering defect.

---

## 2. The fix — two guarded migrations bracket the broken one

**No migration that was already applied in production was edited** (their
checksums are untouched, so no `P3006`/"migration was modified" risk). The
broken migration `20260922194600` is replayed **verbatim**; it is simply given
the relation it asks for:

```
20260922194500  (new)       "Creator"        -> "CreatorProfile"
20260922194600  (untouched) PR004 runs — the foreign key now resolves
20260922194700  (new)       "CreatorProfile" -> "Creator"
20260923120000  (untouched) PR003 performs the real, permanent rename
```

Why rename back in `20260922194700`? Because PR003 (#9) _owns_ the permanent
rename: it re-types the `CreatorStatus` enum on `"Creator"`, renames
`Creator_pkey` / `Creator_organizationId_fkey`, drops the global `Creator_*`
indexes and adds the PR003 columns. It must find the table exactly as it was.
PostgreSQL stores foreign keys by **OID**, so the constraint created by PR004
follows the table through both renames and ends up pointing at
`CreatorProfile` — byte-identical to the schema `prisma/schema.prisma`
describes.

Both new migrations are fully **idempotent**: every statement sits behind a
`to_regclass()` / `information_schema` guard, so on a database that is already
past PR003 they do nothing but record themselves in `_prisma_migrations`.

`20260922194500` additionally cleans up a **half-applied PR004** (empty
leftover `MessageTemplate` / `OutreachMessage` / `FollowUpSequence` tables and
the `OutreachStatus` / `TemplateType` enums) — but only when PR004 is _not_
recorded as finished, and only when those tables are empty. If they hold rows
it aborts with an explicit instruction instead of destroying data. It never
touches `_prisma_migrations` itself.

---

## 3. Reset test (mandatory before every release)

```bash
# 1. wipe the database completely
psql "$DATABASE_URL" -c 'drop schema public cascade;'
psql "$DATABASE_URL" -c 'create schema public;'

# 2. replay the whole history
npx prisma migrate deploy
```

Expected tail:

```
20 migrations found in prisma/migrations
Applying migration `20260922000000_init_multitenant`
...
Applying migration `20260929090000_self_signup_first_tenant`
All migrations have been successfully applied.
```

A static (database-free) version of the same contract runs in CI:

```bash
npx vitest run tests/migration-order.test.ts
```

---

## 4. Recovering a database where `20260922194600` is marked FAILED (P3009)

Symptom on the next deploy:

```
Error: P3009
migrate found failed migrations in the target database, new migrations will not be applied.
The `20260922194600_outreach_ai_sales_pipeline` migration started at ... failed
```

> **Never** `DELETE FROM "_prisma_migrations"`, never drop the table, never edit
> its rows by hand. Use `prisma migrate resolve` only.

```bash
# 0. inspect (read-only)
npx prisma migrate status

# 1. tell Prisma the failed attempt was rolled back
#    (PostgreSQL runs each migration in an implicit transaction, so the failed
#     PR004 left nothing behind — the attempt is genuinely rolled back)
npx prisma migrate resolve --rolled-back 20260922194600_outreach_ai_sales_pipeline

# 2. replay — 20260922194500 now runs first and PR004 succeeds
npx prisma migrate deploy

# 3. confirm
npx prisma migrate status   # => "Database schema is up to date!"
```

On Render: run steps 1–2 in the service **Shell**, or simply redeploy after
step 1 (the `startCommand` already runs `npx prisma migrate deploy`).

### Variant — the PR004 schema is actually in place but recorded as failed

Only if `MessageTemplate`, `OutreachMessage` and `FollowUpSequence` genuinely
exist **with their foreign keys** (verify first!):

```bash
npx prisma migrate resolve --applied 20260922194600_outreach_ai_sales_pipeline
npx prisma migrate deploy
```

---

## 5. Verified states

| Database state                                   | Procedure                                          | Result                                                   |
| ------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------- |
| 100 % empty (`drop schema public cascade`)       | `migrate deploy`                                   | 20/20 applied                                            |
| Partially migrated (stopped at `20260922180000`) | `migrate deploy`                                   | remaining 17 applied, schema identical to a fresh replay |
| `20260922194600` marked **failed** (P3009)       | `migrate resolve --rolled-back` → `migrate deploy` | recovered, schema identical to a fresh replay            |
| Half-applied PR004 (empty leftover tables/enums) | `migrate resolve --rolled-back` → `migrate deploy` | leftovers dropped by the guard, schema identical         |
| Fully migrated, hotfix migrations pending        | `migrate deploy`                                   | both applied as no-ops, schema unchanged                 |
| Up to date                                       | `migrate deploy`                                   | `No pending migrations to apply.`                        |

---

## 6. Rule for future migrations

1. The timestamp prefix **is** the execution order — a migration authored later
   but numbered earlier will run earlier. Never reuse or back-date a prefix to
   "group" work.
2. A migration may only reference relations created by a **strictly earlier**
   migration. `tests/migration-order.test.ts` enforces this.
3. Never edit a migration that has been applied anywhere: add a new, guarded,
   idempotent migration instead.
