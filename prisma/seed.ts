/**
 * Brobond AI Commerce OS — Database Seed
 *
 * Populates the database with a minimal, realistic dataset for local
 * development. Safe to run multiple times (uses upserts).
 *
 *   npm run db:seed
 */
import { PrismaClient, UserRole, ProductStatus, CreatorStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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

  const admin = await prisma.user.upsert({
    where: { email: "admin@brobond.ai" },
    update: { organizationId: organization.id },
    create: {
      email: "admin@brobond.ai",
      name: "Brobond Admin",
      role: UserRole.ADMIN,
      organizationId: organization.id,
    },
  });

  const product = await prisma.product.upsert({
    where: { slug: "starter-hoodie" },
    update: { organizationId: organization.id },
    create: {
      name: "Starter Hoodie",
      slug: "starter-hoodie",
      description: "Premium heavyweight hoodie — the flagship demo product.",
      sku: "BB-HOODIE-001",
      priceCents: 6900,
      currency: "BRL",
      status: ProductStatus.ACTIVE,
      organizationId: organization.id,
    },
  });

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
