import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/tenant", () => ({
  tenantWhere: (organizationId: string) => ({ organizationId }),
  scopedWhere: (organizationId: string, where: Record<string, unknown> = {}) => ({
    ...where,
    organizationId,
  }),
}));

import { createTikTokImportRepository } from "@/modules/connectors/tiktok/sync/importer";
import {
  mapTikTokCreator,
  mapTikTokProduct,
  mapTikTokProductExternalContent,
} from "@/modules/connectors/tiktok/sync/mapper";

function importDb() {
  const products: Record<string, unknown>[] = [];
  const creators: Record<string, unknown>[] = [];
  const contents: Record<string, unknown>[] = [];
  return {
    products,
    creators,
    contents,
    product: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          products.find(
            (product) =>
              product.organizationId === where.organizationId &&
              product.tiktokProductId === where.tiktokProductId,
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `product-${products.length + 1}`, ...data };
        products.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = products.find((product) => product.id === where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
    },
    creatorProfile: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.externalId)
          return (
            creators.find(
              (creator) =>
                creator.externalId === where.externalId &&
                creator.organizationId === where.organizationId,
            ) ?? null
          );
        return (
          creators.find(
            (creator) =>
              creator.handle === where.handle && creator.organizationId === where.organizationId,
          ) ?? null
        );
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `creator-${creators.length + 1}`, ...data };
        creators.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = creators.find((creator) => creator.id === where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
    },
    externalContent: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          contents.find(
            (content) =>
              content.externalId === where.externalId &&
              content.organizationId === where.organizationId,
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `content-${contents.length + 1}`, ...data };
        contents.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = contents.find((content) => content.id === where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
    },
    auditLog: { create: vi.fn() },
  };
}

describe("TikTok importer persistence", () => {
  it("upserts Product, CreatorProfile and ExternalContent without duplicate rows", async () => {
    const db = importDb();
    const repository = createTikTokImportRepository(db as never);
    const org = "org-1";
    const source = {
      product_id: "prod-1",
      title: "Produto original",
      skus: [{ price: { price: "10.00" } }],
    };

    await expect(repository.upsertProduct(org, mapTikTokProduct(source))).resolves.toEqual({
      created: true,
    });
    await expect(
      repository.upsertProduct(org, mapTikTokProduct({ ...source, title: "Produto atualizado" })),
    ).resolves.toEqual({ created: false });
    expect(db.products).toHaveLength(1);
    expect(db.products[0]!.name).toBe("Produto atualizado");

    const creator = mapTikTokCreator({ creator_id: "creator-1", username: "ana" });
    await expect(repository.upsertCreator(org, creator)).resolves.toEqual({ created: true });
    await expect(
      repository.upsertCreator(org, { ...creator, displayName: "Ana Atualizada" }),
    ).resolves.toEqual({ created: false });
    expect(db.creators).toHaveLength(1);
    expect(db.creators[0]!.displayName).toBe("Ana Atualizada");

    const content = mapTikTokProductExternalContent(source, "shop-1");
    await expect(repository.upsertExternalContent(org, content)).resolves.toEqual({
      created: true,
    });
    await expect(repository.upsertExternalContent(org, content)).resolves.toEqual({
      created: false,
    });
    expect(db.contents).toHaveLength(1);
  });

  it("writes organization scope on all imported records", async () => {
    const db = importDb();
    const repository = createTikTokImportRepository(db as never);
    const source = { product_id: "prod-1", title: "Produto" };
    await repository.upsertProduct("org-a", mapTikTokProduct(source));
    await repository.upsertProduct("org-b", mapTikTokProduct(source));
    expect(db.products).toHaveLength(2);
    expect(new Set(db.products.map((product) => product.organizationId))).toEqual(
      new Set(["org-a", "org-b"]),
    );
  });
});
