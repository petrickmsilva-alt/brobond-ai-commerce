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
import { PrismaClient, UserRole, ProductStatus, CreatorStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

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

  const creator = await prisma.creator.upsert({
    where: { handle: "@demo_creator" },
    update: { organizationId: organization.id },
    create: {
      handle: "@demo_creator",
      displayName: "Demo Creator",
      email: "creator@brobond.ai",
      followers: 125000,
      status: CreatorStatus.ACTIVE,
      organizationId: organization.id,
    },
  });

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
      creators: { create: { creatorId: creator.id } },
    },
  });

  // eslint-disable-next-line no-console
  console.log("Seed complete:", {
    organization: organization.slug,
    admin: admin.email,
    adminLogin: passwordHash
      ? "enabled (bcrypt hash stored)"
      : "disabled — set SEED_ADMIN_PASSWORD and re-run to enable",
    product: product.slug,
    creator: creator.handle,
    campaign: campaign.slug,
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
