/**
 * Brobond AI Commerce OS — Database Seed
 *
 * Populates the database with a minimal, realistic dataset for local
 * development. Safe to run multiple times (uses upserts).
 *
 *   npm run db:seed
 *
 * TENANCY: every domain record is created inside the `brobond` Organization —
 * `organizationId` is NOT NULL on User/Product/Creator/Campaign (PR000.2).
 *
 * SECURITY: there is no public sign-up. The seed is the only bootstrap path
 * for the first ADMIN account, and it stores **only a bcrypt hash**. When
 * `SEED_ADMIN_PASSWORD` is not set, the admin is created WITHOUT a password
 * (credentials login disabled for that account) — no password is invented.
 */
import {
  PrismaClient,
  UserRole,
  ProductStatus,
  CreatorSource,
  CreatorStatus,
  TrendSource,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { MOCK_TREND_SIGNALS } from "../modules/trends/hunter/collector";
import { scoreTrend } from "../modules/trends/hunter/scorer";
import { normalizeKeyword } from "../modules/trends/validators/trend.validator";
import { MOCK_CREATOR_CANDIDATES } from "../modules/creators/discovery/collectors";
import { scoreCreator } from "../modules/creators/discovery/scorer";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BCRYPT_COST = 12;

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? "admin@brobond.ai").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD?.trim() || null;

async function main() {
  // Tenant boundary — everything below belongs to this Organization.
  const organization = await prisma.organization.upsert({
    where: { slug: "brobond" },
    update: {},
    create: {
      name: "Brobond",
      slug: "brobond",
    },
  });

  const passwordHash = ADMIN_PASSWORD ? await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_COST) : null;

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    // Only overwrite the hash when a password was explicitly supplied.
    update: {
      organizationId: organization.id,
      ...(passwordHash ? { passwordHash } : {}),
    },
    create: {
      email: ADMIN_EMAIL,
      name: "Brobond Admin",
      role: UserRole.ADMIN,
      organizationId: organization.id,
      passwordHash,
    },
  });

  // Slug/SKU are tenant-scoped unique since PR001 → compound unique key.
  const product = await prisma.product.upsert({
    where: {
      organizationId_slug: { organizationId: organization.id, slug: "starter-hoodie" },
    },
    update: {},
    create: {
      name: "Starter Hoodie",
      slug: "starter-hoodie",
      description: "Premium heavyweight hoodie — the flagship demo product.",
      sku: "BB-HOODIE-001",
      priceCents: 6900,
      currency: "BRL",
      status: ProductStatus.ACTIVE,
      stockQuantity: 120,
      organizationId: organization.id,
    },
  });

  // PR001 — Product Intelligence Core: cost snapshot + automatic margin.
  const existingCost = await prisma.productCost.findFirst({
    where: { productId: product.id, organizationId: organization.id },
  });
  if (!existingCost) {
    await prisma.productCost.create({
      data: {
        productId: product.id,
        organizationId: organization.id,
        unitCents: 2500,
        freightCents: 300,
        packagingCents: 200,
        feesCents: 0,
        otherCents: 0,
        currency: "BRL",
        note: "Custo inicial (seed)",
      },
    });
    const costTotal = 2500 + 300 + 200;
    await prisma.product.update({
      where: { id: product.id },
      data: {
        currentCostCents: costTotal,
        marginBps: Math.round(((6900 - costTotal) / 6900) * 10_000),
      },
    });
  }

  // PR003 — Creator Discovery Engine: 100 seeded creator profiles via the
  // real pipeline (mock collector → score engine). Niche distribution is
  // pinned by tests/creator-collector.test.ts (Moda 35 · Casual 20 ·
  // Street 20 · Fitness 15 · Executivo 10; followers 5k–2M). Idempotent:
  // only inserts when the workspace has no profiles yet, so real
  // discoveries are never wiped.
  const existingCreators = await prisma.creatorProfile.count({
    where: { organizationId: organization.id },
  });

  /** Deterministic pipeline spread so the Kanban ships alive:
   *  NEW 40% · QUALIFIED 20% · CONTACTED 15% · NEGOTIATING 10% ·
   *  ACTIVE 10% · ARCHIVED 5%. */
  function seededCreatorStatus(index: number): CreatorStatus {
    const bucket = index % 20;
    if (bucket < 8) return CreatorStatus.NEW;
    if (bucket < 12) return CreatorStatus.QUALIFIED;
    if (bucket < 15) return CreatorStatus.CONTACTED;
    if (bucket < 17) return CreatorStatus.NEGOTIATING;
    if (bucket < 19) return CreatorStatus.ACTIVE;
    return CreatorStatus.ARCHIVED;
  }

  let seededCreators = 0;
  if (existingCreators === 0) {
    const scored = MOCK_CREATOR_CANDIDATES.map((candidate) => scoreCreator(candidate));

    const created = await prisma.creatorProfile.createMany({
      data: scored.map((creator, index) => ({
        externalId: creator.externalId,
        handle: creator.handle,
        displayName: creator.displayName,
        niche: creator.niche,
        followers: creator.followers,
        avgViews: creator.avgViews,
        engagementRate: creator.engagementRate,
        creatorScore: creator.creatorScore,
        status: seededCreatorStatus(index),
        source: CreatorSource.MOCK,
        organizationId: organization.id,
      })),
    });
    seededCreators = created.count;

    // Re-read to obtain ids (createMany returns none) → tags + metrics.
    const profiles = await prisma.creatorProfile.findMany({
      where: { organizationId: organization.id },
      orderBy: { externalId: "asc" },
    });
    const byExternalId = new Map(profiles.map((profile) => [profile.externalId, profile]));

    // Tags — one row per (profile, tag), from the mock candidate labels.
    const tagRows = scored.flatMap((creator) => {
      const profile = byExternalId.get(creator.externalId);
      if (!profile) return [];
      return (creator.tags ?? []).map((name) => ({
        name,
        creatorProfileId: profile.id,
        organizationId: organization.id,
      }));
    });
    if (tagRows.length > 0) {
      await prisma.creatorTag.createMany({ data: tagRows, skipDuplicates: true });
    }

    // Metrics — 7 daily snapshots for the 10 highest-scoring profiles.
    const top10 = [...profiles].sort((a, b) => b.creatorScore - a.creatorScore).slice(0, 10);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const metricRows = top10.flatMap((profile, rank) =>
      Array.from({ length: 7 }, (_, dayOffset) => {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - (6 - dayOffset));
        // Gentle deterministic wiggle so the series is not flat.
        const drift = 0.85 + ((dayOffset + rank) % 5) * 0.06;
        return {
          date,
          views: Math.round(profile.avgViews * drift),
          likes: Math.round(profile.avgViews * (profile.engagementRate / 100) * drift),
          shares: Math.round(profile.avgViews * (profile.engagementRate / 100) * 0.1 * drift),
          followers: Math.round(profile.followers * (0.94 + dayOffset * 0.01)),
          creatorProfileId: profile.id,
          organizationId: organization.id,
        };
      }),
    );
    if (metricRows.length > 0) {
      await prisma.creatorMetric.createMany({ data: metricRows });
    }
  }

  const campaign = await prisma.campaign.upsert({
    where: { slug: "launch-campaign" },
    update: { organizationId: organization.id },
    create: {
      name: "Launch Campaign",
      slug: "launch-campaign",
      description: "Inaugural go-to-market campaign for the flagship product.",
      budgetCents: 500000,
      currency: "BRL",
      ownerId: admin.id,
      organizationId: organization.id,
      products: { create: { productId: product.id } },
    },
  });

  // Attach the strongest ACTIVE creator to the demo campaign (first run only).
  const campaignCreator = await prisma.campaignCreator.findFirst({
    where: { campaignId: campaign.id },
  });
  if (!campaignCreator) {
    const anchor = await prisma.creatorProfile.findFirst({
      where: { organizationId: organization.id, status: CreatorStatus.ACTIVE },
      orderBy: { creatorScore: "desc" },
    });
    if (anchor) {
      await prisma.campaignCreator.create({
        data: { campaignId: campaign.id, creatorId: anchor.id },
      });
    }
  }

  // PR002 — Trend Hunter AI: 30 seeded trend snapshots via the real pipeline
  // (mock collector → score engine). Scores land between 60 and 98 (pinned
  // by tests/trend-collector.test.ts). Idempotent: only inserts when the
  // workspace has no snapshots yet, so real collections are never wiped.
  const existingTrends = await prisma.trendSnapshot.count({
    where: { organizationId: organization.id },
  });
  if (existingTrends === 0) {
    const scored = MOCK_TREND_SIGNALS.map((signal) =>
      scoreTrend({ ...signal, keyword: normalizeKeyword(signal.keyword) }),
    );

    await prisma.trendSnapshot.createMany({
      data: scored.map((trend) => ({
        keyword: trend.keyword,
        category: trend.category,
        views: trend.views,
        likes: trend.likes,
        shares: trend.shares,
        trendScore: trend.trendScore,
        // PR002.1 — seeded snapshots come from the mock pipeline.
        source: TrendSource.MOCK,
        organizationId: organization.id,
      })),
    });

    // Keyword frequency — every seeded keyword has been seen once.
    for (const trend of scored) {
      await prisma.trendKeyword.create({
        data: { keyword: trend.keyword, frequency: 1, organizationId: organization.id },
      });
    }

    // Category score — average of the seeded trends, per category.
    const scoresByCategory = new Map<string, number[]>();
    for (const trend of scored) {
      const list = scoresByCategory.get(trend.category) ?? [];
      list.push(trend.trendScore);
      scoresByCategory.set(trend.category, list);
    }
    for (const [category, scores] of scoresByCategory) {
      const average = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
      await prisma.trendCategory.create({
        data: { name: category, score: average, organizationId: organization.id },
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log("Seed complete:", {
    organization: organization.slug,
    admin: admin.email,
    adminLogin: passwordHash
      ? "enabled (bcrypt hash stored)"
      : "disabled — set SEED_ADMIN_PASSWORD and re-run to enable",
    product: product.slug,
    creators: existingCreators > 0 ? existingCreators : seededCreators,
    campaign: campaign.slug,
    trends: existingTrends > 0 ? existingTrends : MOCK_TREND_SIGNALS.length,
  });
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
