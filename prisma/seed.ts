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
  const admin = await prisma.user.upsert({
    where: { email: "admin@brobond.ai" },
    update: {},
    create: {
      email: "admin@brobond.ai",
      name: "Brobond Admin",
      role: UserRole.ADMIN,
    },
  });

  const product = await prisma.product.upsert({
    where: { slug: "starter-hoodie" },
    update: {},
    create: {
      name: "Starter Hoodie",
      slug: "starter-hoodie",
      description: "Premium heavyweight hoodie — the flagship demo product.",
      sku: "BB-HOODIE-001",
      priceCents: 6900,
      currency: "USD",
      status: ProductStatus.ACTIVE,
    },
  });

  const creator = await prisma.creator.upsert({
    where: { handle: "@demo_creator" },
    update: {},
    create: {
      handle: "@demo_creator",
      displayName: "Demo Creator",
      email: "creator@brobond.ai",
      followers: 125000,
      status: CreatorStatus.ACTIVE,
    },
  });

  const campaign = await prisma.campaign.upsert({
    where: { slug: "launch-campaign" },
    update: {},
    create: {
      name: "Launch Campaign",
      slug: "launch-campaign",
      description: "Inaugural go-to-market campaign for the flagship product.",
      budgetCents: 500000,
      currency: "USD",
      ownerId: admin.id,
      products: { create: { productId: product.id } },
      creators: { create: { creatorId: creator.id } },
    },
  });

  // eslint-disable-next-line no-console
  console.log("Seed complete:", {
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
