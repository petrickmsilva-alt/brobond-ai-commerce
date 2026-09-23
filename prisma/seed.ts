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
  ConnectorPlatform,
  CreatorSource,
  CreatorStatus,
  TrendSource,
  OutreachStatus,
  TemplateType,
  MatchSource,
  type MessageTemplate,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { MOCK_TREND_SIGNALS } from "../modules/trends/hunter/collector";
import { scoreTrend } from "../modules/trends/hunter/scorer";
import { normalizeKeyword } from "../modules/trends/validators/trend.validator";
import { MOCK_CREATOR_CANDIDATES } from "../modules/creators/discovery/collectors";
import { scoreCreator } from "../modules/creators/discovery/scorer";
import { MockConnector } from "../modules/connectors/mock/mock.connector";
import { OUTREACH_TEMPLATES } from "../modules/outreach/prompts/templates";
import { generateOutreachMessage } from "../modules/outreach/prompts/generator";
import { matchProductsToContent, recommendCreators } from "../modules/campaigns/matching/matcher";
import { buildSeedSales } from "../modules/analytics/seed/sales-seed";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const BCRYPT_COST = 12;

/** Single reference instant for all relative-date seed rows (PR008 sales). */
const NOW = new Date();

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

  // PR005.1 — Product Match Architecture: a curated catalog aligned with the
  // twelve mock content topics (camisa masculina, jaqueta premium, …), so
  // the matcher engine has real products to relate the imported content to.
  // Six topics get a sibling product (same category, different offer) so the
  // confidence distribution has natural variety. Idempotent upserts — a
  // re-run never duplicates or overwrites catalog rows.
  const MATCH_PRODUCT_CATALOG = [
    {
      name: "Camisa Masculina",
      slug: "camisa-masculina",
      sku: "BB-M-001",
      description: "Camisa de algodão com corte clássico.",
      priceCents: 12900,
      stockQuantity: 80,
    },
    {
      name: "Camisa Slim Fit",
      slug: "camisa-slim-fit",
      sku: "BB-M-002",
      description: "Camisa slim fit para looks executivos.",
      priceCents: 14900,
      stockQuantity: 60,
    },
    {
      name: "Jaqueta Premium",
      slug: "jaqueta-premium",
      sku: "BB-M-003",
      description: "Jaqueta premium em couro ecológico.",
      priceCents: 39900,
      stockQuantity: 40,
    },
    {
      name: "Jaqueta Impermeável",
      slug: "jaqueta-impermeavel",
      sku: "BB-M-004",
      description: "Jaqueta impermeável para uso urbano.",
      priceCents: 44900,
      stockQuantity: 35,
    },
    {
      name: "Bermuda Cargo Tática",
      slug: "bermuda-cargo-tatica",
      sku: "BB-M-005",
      description: "Bermuda cargo com bolsos reforçados.",
      priceCents: 15900,
      stockQuantity: 90,
    },
    {
      name: "Camiseta Oversized",
      slug: "camiseta-oversized",
      sku: "BB-M-006",
      description: "Camiseta oversized em malha penteada.",
      priceCents: 8900,
      stockQuantity: 150,
    },
    {
      name: "Camiseta Dry Fit",
      slug: "camiseta-dry-fit",
      sku: "BB-M-007",
      description: "Camiseta dry fit para treino e dia a dia.",
      priceCents: 7900,
      stockQuantity: 200,
    },
    {
      name: "Hoodie Streetwear",
      slug: "hoodie-streetwear",
      sku: "BB-M-008",
      description: "Hoodie heavyweight com estampa limitada.",
      priceCents: 24900,
      stockQuantity: 70,
    },
    {
      name: "Hoodie Básico",
      slug: "hoodie-basico",
      sku: "BB-M-009",
      description: "Hoodie básico em moletom fleece.",
      priceCents: 19900,
      stockQuantity: 120,
    },
    {
      name: "Tênis Chunky",
      slug: "tenis-chunky",
      sku: "BB-M-010",
      description: "Tênis chunky com solado reforçado.",
      priceCents: 34900,
      stockQuantity: 50,
    },
    {
      name: "Tênis de Corrida",
      slug: "tenis-corrida",
      sku: "BB-M-011",
      description: "Tênis de corrida com amortecimento.",
      priceCents: 29900,
      stockQuantity: 45,
    },
    {
      name: "Terno Slim Fit",
      slug: "terno-slim-fit",
      sku: "BB-M-012",
      description: "Terno slim fit em lã fria.",
      priceCents: 89900,
      stockQuantity: 20,
    },
    {
      name: "Relógio Minimalista",
      slug: "relogio-minimalista",
      sku: "BB-M-013",
      description: "Relógio minimalista com pulseira de aço.",
      priceCents: 59900,
      stockQuantity: 30,
    },
    {
      name: "Regata Fitness",
      slug: "regata-fitness",
      sku: "BB-M-014",
      description: "Regata fitness com tecido respirável.",
      priceCents: 6900,
      stockQuantity: 110,
    },
    {
      name: "Regatas Fitness (Pack 3)",
      slug: "regatas-fitness",
      sku: "BB-M-015",
      description: "Pack com 3 regatas fitness.",
      priceCents: 17900,
      stockQuantity: 60,
    },
    {
      name: "Calça Jogger",
      slug: "calca-jogger",
      sku: "BB-M-016",
      description: "Calça jogger com punhos elásticos.",
      priceCents: 18900,
      stockQuantity: 75,
    },
    {
      name: "Calça Sarja",
      slug: "calca-sarja",
      sku: "BB-M-017",
      description: "Calça de sarja com corte reto.",
      priceCents: 16900,
      stockQuantity: 85,
    },
    {
      name: "Boné Aba Reta",
      slug: "bone-aba-reta",
      sku: "BB-M-018",
      description: "Boné aba reta ajustável.",
      priceCents: 9900,
      stockQuantity: 130,
    },
  ] as const;

  for (const item of MATCH_PRODUCT_CATALOG) {
    await prisma.product.upsert({
      where: {
        organizationId_slug: { organizationId: organization.id, slug: item.slug },
      },
      update: {},
      create: {
        name: item.name,
        slug: item.slug,
        description: item.description,
        sku: item.sku,
        priceCents: item.priceCents,
        currency: "BRL",
        status: ProductStatus.ACTIVE,
        stockQuantity: item.stockQuantity,
        organizationId: organization.id,
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

  // PR004 — 8 tenant templates + 63 outbox records. This is deterministic,
  // idempotent and only uses the local template engine (no provider/network).
  const seededTemplates: MessageTemplate[] = [];
  for (const definition of OUTREACH_TEMPLATES) {
    seededTemplates.push(
      await prisma.messageTemplate.upsert({
        where: {
          organizationId_name: { organizationId: organization.id, name: definition.name },
        },
        update: { type: TemplateType[definition.type], content: definition.content },
        create: {
          ...definition,
          type: TemplateType[definition.type],
          organizationId: organization.id,
        },
      }),
    );
  }

  const followUpTemplates = seededTemplates.filter((template) => template.type === "FOLLOW_UP");
  for (const [index, daysAfter] of [3, 7, 15].entries()) {
    const template = followUpTemplates[index % followUpTemplates.length]!;
    await prisma.followUpSequence.upsert({
      where: {
        organizationId_name: {
          organizationId: organization.id,
          name: `Follow-up +${daysAfter} dias`,
        },
      },
      update: { daysAfter, templateId: template.id, active: true },
      create: {
        name: `Follow-up +${daysAfter} dias`,
        daysAfter,
        templateId: template.id,
        active: true,
        organizationId: organization.id,
      },
    });
  }

  const existingOutreach = await prisma.outreachMessage.count({
    where: { organizationId: organization.id },
  });
  if (existingOutreach === 0) {
    const creators = await prisma.creatorProfile.findMany({
      where: { organizationId: organization.id },
      orderBy: { creatorScore: "desc" },
      take: 63,
    });
    const trend = await prisma.trendSnapshot.findFirst({
      where: { organizationId: organization.id },
      orderBy: { trendScore: "desc" },
    });
    const statuses: OutreachStatus[] = [
      ...Array<OutreachStatus>(40).fill(OutreachStatus.DRAFT),
      ...Array<OutreachStatus>(15).fill(OutreachStatus.SCHEDULED),
      ...Array<OutreachStatus>(5).fill(OutreachStatus.SENT),
      ...Array<OutreachStatus>(3).fill(OutreachStatus.FAILED),
    ];
    const now = new Date();
    await prisma.outreachMessage.createMany({
      data: statuses.map((status, index) => {
        const creator = creators[index % creators.length]!;
        const template = seededTemplates[index % seededTemplates.length]!;
        const scheduledFor =
          status === OutreachStatus.SCHEDULED
            ? new Date(now.getTime() + (index + 1) * 3_600_000)
            : null;
        const sentAt =
          status === OutreachStatus.SENT ? new Date(now.getTime() - (index + 1) * 3_600_000) : null;
        return {
          organizationId: organization.id,
          creatorId: creator.id,
          productId: product.id,
          campaignId: campaign.id,
          templateId: template.id,
          createdById: admin.id,
          status,
          scheduledFor,
          sentAt,
          generatedText: generateOutreachMessage({
            creator,
            product,
            campaign,
            trend: trend ?? { keyword: creator.niche },
            template: template.content,
          }),
        };
      }),
    });
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

  // PR005 — Connector Framework: register one ConnectorStatus row per
  // platform and import the mock dataset through the SAME dedupe rule the
  // sync service uses (first occurrence IMPORTED, repeats DUPLICATE), so
  // the dashboard KPIs have realistic data on a fresh workspace.
  //
  // NO external API is called here — the mock connector is in-memory only.
  // Idempotent: only inserts when the workspace has no external content
  // yet, so real syncs are never wiped.
  const existingContent = await prisma.externalContent.count({
    where: { organizationId: organization.id },
  });
  let seededContent = 0;
  if (existingContent === 0) {
    const mockContent = await new MockConnector().fetchContent();

    const status = await prisma.connectorStatus.upsert({
      where: {
        organizationId_platform: {
          organizationId: organization.id,
          platform: ConnectorPlatform.MOCK,
        },
      },
      update: {},
      create: {
        platform: ConnectorPlatform.MOCK,
        organizationId: organization.id,
        enabled: true,
        state: "IDLE",
      },
    });

    const seen = new Set<string>();
    let imported = 0;
    let duplicates = 0;

    for (const item of mockContent) {
      const isDuplicate = seen.has(item.externalId);
      if (isDuplicate) {
        duplicates += 1;
        continue;
      }
      seen.add(item.externalId);
      imported += 1;
      await prisma.externalContent.create({
        data: {
          platform: ConnectorPlatform.MOCK,
          externalId: item.externalId,
          type: item.type,
          status: "IMPORTED",
          title: item.title,
          url: item.url,
          thumbnailUrl: item.thumbnailUrl,
          authorHandle: item.authorHandle,
          caption: item.caption,
          views: item.views ?? 0,
          likes: item.likes ?? 0,
          shares: item.shares ?? 0,
          publishedAt: item.publishedAt,
          connectorStatusId: status.id,
          organizationId: organization.id,
        },
      });
    }

    // The duplicate hits are recorded on the connector counters — a
    // duplicate never creates a second content row (that is the point).
    await prisma.connectorStatus.update({
      where: { id: status.id },
      data: {
        state: "ACTIVE",
        lastSyncAt: new Date(),
        importedCount: imported,
        duplicateCount: duplicates,
        syncCount: 1,
      },
    });

    // The three placeholder platforms are registered but disabled — they
    // render on the dashboard as IDLE / "placeholder" until a future PR
    // implements the real adapters.
    for (const platform of [
      ConnectorPlatform.TIKTOK,
      ConnectorPlatform.INSTAGRAM,
      ConnectorPlatform.SHOPEE,
    ]) {
      await prisma.connectorStatus.upsert({
        where: { organizationId_platform: { organizationId: organization.id, platform } },
        update: {},
        create: { platform, organizationId: organization.id, enabled: false, state: "IDLE" },
      });
    }

    seededContent = imported;
  }

  // PR005.1 — Product Match Architecture: 50 matches generated through the
  // REAL matcher engine (rules only — no AI, no vision, no embeddings, no
  // TikTok) over the existing ExternalContent and Products of this
  // workspace. Distribution: 20 AI · 20 RULE · 10 MANUAL; confidence is the
  // engine's own output filtered to the 0.55–0.99 band. Idempotent: only
  // inserts when the workspace has no matches yet, so real curation is
  // never wiped.
  const SEED_MATCH_COUNT = 50;
  const SEED_MATCH_AI_COUNT = 20;
  const SEED_MATCH_RULE_COUNT = 20; // the remaining 10 are MANUAL
  const SEED_MATCH_MIN_CONFIDENCE = 0.55;
  const SEED_MATCH_MAX_CONFIDENCE = 0.99;

  const existingMatches = await prisma.productMatch.count({
    where: { organizationId: organization.id },
  });
  let seededMatches = 0;
  if (existingMatches === 0) {
    const [seedContents, seedProducts] = await Promise.all([
      prisma.externalContent.findMany({ where: { organizationId: organization.id } }),
      prisma.product.findMany({ where: { organizationId: organization.id } }),
    ]);

    const drafts = matchProductsToContent(seedContents, seedProducts)
      .filter(
        (draft) =>
          draft.confidence >= SEED_MATCH_MIN_CONFIDENCE &&
          draft.confidence <= SEED_MATCH_MAX_CONFIDENCE,
      )
      .slice(0, SEED_MATCH_COUNT);

    for (const [index, draft] of drafts.entries()) {
      const matchedBy =
        index < SEED_MATCH_AI_COUNT
          ? MatchSource.AI
          : index < SEED_MATCH_AI_COUNT + SEED_MATCH_RULE_COUNT
            ? MatchSource.RULE
            : MatchSource.MANUAL;
      await prisma.productMatch.create({
        data: { ...draft, matchedBy, organizationId: organization.id },
      });
    }
    seededMatches = drafts.length;
  }

  // PR006 — five campaigns and exactly 200 audience recommendations.
  // Every row comes from recommendCreators(); no random/manual score exists.
  const campaignDefinitions = [
    { slug: "launch-campaign", name: "Launch Campaign", niche: null },
    { slug: "moda-em-alta", name: "Moda em Alta", niche: "Moda" },
    { slug: "street-drop", name: "Street Drop", niche: "Street" },
    { slug: "fitness-performance", name: "Fitness Performance", niche: "Fitness" },
    { slug: "executivo-premium", name: "Executivo Premium", niche: "Executivo" },
  ] as const;
  const allSeedProducts = await prisma.product.findMany({
    where: { organizationId: organization.id, status: ProductStatus.ACTIVE },
    orderBy: { slug: "asc" },
  });
  const seedCampaigns = [];
  for (const [index, definition] of campaignDefinitions.entries()) {
    const row = await prisma.campaign.upsert({
      where: { slug: definition.slug },
      update: { organizationId: organization.id, audienceType: "SCORE" },
      create: {
        name: definition.name,
        slug: definition.slug,
        status: "DRAFT",
        budgetCents: 500_000 + index * 100_000,
        ownerId: admin.id,
        organizationId: organization.id,
        audienceType: "SCORE",
      },
    });
    seedCampaigns.push({ row, preferredNiche: definition.niche });
    await prisma.campaignRule.upsert({
      where: { campaignId: row.id },
      update: { preferredNiche: definition.niche, active: true },
      create: {
        campaignId: row.id,
        organizationId: organization.id,
        minimumCreatorScore: 0,
        minimumTrendScore: 0,
        minimumProductMargin: 0,
        preferredNiche: definition.niche,
        active: true,
      },
    });
    await prisma.campaignProduct.createMany({
      data: allSeedProducts.map((item) => ({ campaignId: row.id, productId: item.id })),
      skipDuplicates: true,
    });
  }

  const existingAudience = await prisma.campaignAudience.count({
    where: { organizationId: organization.id },
  });
  let seededRecommendations = 0;
  if (existingAudience === 0) {
    const [audienceCreators, audienceMatches, audienceTrends] = await Promise.all([
      prisma.creatorProfile.findMany({ where: { organizationId: organization.id } }),
      prisma.productMatch.findMany({ where: { organizationId: organization.id } }),
      prisma.trendSnapshot.findMany({ where: { organizationId: organization.id } }),
    ]);
    for (const { row, preferredNiche } of seedCampaigns) {
      const recommendations = recommendCreators(
        row,
        allSeedProducts,
        audienceCreators,
        audienceMatches,
        audienceTrends,
        { preferredNiche, active: true },
      ).slice(0, 40);
      await prisma.campaignAudience.createMany({
        data: recommendations.map((item) => ({
          organizationId: organization.id,
          campaignId: item.campaignId,
          creatorId: item.creatorId,
          productId: item.productId,
          matchScore: item.matchScore,
          recommended: item.recommended,
        })),
      });
      seededRecommendations += recommendations.length;
    }
  }

  // PR008 — Analytics & Attribution: 40 deterministic sales (28 PAID ·
  // 5 PENDING · 4 REFUNDED · 3 CANCELLED) over the last 30 days, linked
  // round-robin to the workspace's real products/creators/campaigns so
  // every attribution bucket has data. Idempotent: only inserts when the
  // workspace has no sales yet, so real revenue is never duplicated.
  const existingSales = await prisma.sale.count({
    where: { reference: { startsWith: "seed-sale-" } },
  });
  let seededSales = 0;
  const hasAnySale = await prisma.sale.count();
  if (existingSales === 0 && hasAnySale === 0) {
    const products = allSeedProducts.map((item) => ({ id: item.id, priceCents: item.priceCents }));
    const saleCreators = await prisma.creatorProfile.findMany({
      where: { organizationId: organization.id },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const saleCampaigns = await prisma.campaign.findMany({
      where: { organizationId: organization.id },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const drafts = buildSeedSales(products, saleCreators, saleCampaigns, NOW);
    await prisma.sale.createMany({
      data: drafts.map((draft) => ({ ...draft, currency: "BRL" })),
    });
    seededSales = drafts.length;
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
    externalContent: existingContent > 0 ? existingContent : seededContent,
    productMatches: existingMatches > 0 ? existingMatches : seededMatches,
    campaigns: seedCampaigns.length,
    recommendations: existingAudience > 0 ? existingAudience : seededRecommendations,
    sales: existingSales > 0 ? existingSales : seededSales,
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
