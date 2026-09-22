import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toListItemDTO, type ProductPageDTO } from "../dto/product.dto";
import { marginBps, totalCostCents } from "../pricing/margin";
import { productRepository } from "../repositories/product.repository";
import { productCostRepository } from "../repositories/product-cost.repository";
import type {
  CreateProductInput,
  ProductListQuery,
  UpdateProductInput,
} from "../validators/product.schema";
import { createProductSchema, updateProductSchema } from "../validators/product.schema";
import { resolveUniqueSlug } from "../validators/slug";

/**
 * Product service — business logic for the Product aggregate root.
 *
 * TENANT ISOLATION: every function takes `organizationId` as its FIRST
 * argument and delegates data access to the tenant-scoped repositories.
 *
 * PRICING: `Product.marginBps` and `Product.currentCostCents` are a
 * denormalized snapshot recomputed on every price/cost mutation
 * (see `recalculatePricing`).
 */

export class ProductNotFoundError extends Error {
  constructor() {
    super("Produto não encontrado.");
    this.name = "ProductNotFoundError";
  }
}

/** Recompute and persist the margin snapshot for one product (scoped). */
export async function recalculatePricing(organizationId: string, productId: string) {
  const product = await productRepository.findById(organizationId, productId);
  if (!product) throw new ProductNotFoundError();

  const currentCost = await productCostRepository.findCurrent(organizationId, productId);
  const currentCostCents = currentCost ? totalCostCents(currentCost) : 0;
  const bps = marginBps(product.priceCents, currentCostCents);

  return productRepository.update(organizationId, productId, {
    currentCostCents,
    marginBps: bps,
  });
}

export const productService = {
  /** Paginated, filtered, searchable dashboard listing. */
  async page(organizationId: string, query: ProductListQuery): Promise<ProductPageDTO> {
    const { items, total } = await productRepository.page(organizationId, query);
    return {
      items: items.map(toListItemDTO),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  },

  getById(organizationId: string, id: string) {
    return productRepository.findById(organizationId, id);
  },

  getBySlug(organizationId: string, slug: string) {
    return productRepository.findBySlug(organizationId, slug);
  },

  /**
   * Create a product. The slug is derived automatically from the name
   * (tenant-unique, `-2`/`-3`… suffix on collision) unless the caller passes
   * an explicit valid slug.
   */
  async create(organizationId: string, input: CreateProductInput) {
    const data = createProductSchema.parse(input);

    const slug = await resolveUniqueSlug(
      data.name,
      (candidate) => productRepository.slugExists(organizationId, candidate),
      { preferred: data.slug },
    );

    const product = await productRepository.create(organizationId, {
      name: data.name,
      slug,
      description: data.description ?? null,
      sku: data.sku ?? null,
      priceCents: data.priceCents,
      currency: data.currency,
      status: data.status,
      stockQuantity: data.stockQuantity,
      imageUrl: data.imageUrl ?? null,
      // New product has no cost yet → margin is 100% of price (cost 0).
      currentCostCents: 0,
      marginBps: marginBps(data.priceCents, 0),
    });

    return product;
  },

  /** Update a product; recomputes the margin snapshot when the price changes. */
  async update(organizationId: string, id: string, input: UpdateProductInput) {
    const data = updateProductSchema.parse(input);

    const existing = await productRepository.findById(organizationId, id);
    if (!existing) throw new ProductNotFoundError();

    let slug: string | undefined;
    if (data.slug && data.slug !== existing.slug) {
      slug = await resolveUniqueSlug(data.slug, (candidate) =>
        productRepository.slugExists(organizationId, candidate, id),
      );
    } else if (data.name && data.name !== existing.name && !data.slug) {
      // Name changed without an explicit slug → regenerate from the new name.
      slug = await resolveUniqueSlug(data.name, (candidate) =>
        productRepository.slugExists(organizationId, candidate, id),
      );
    }

    const patch: Prisma.ProductUncheckedUpdateInput = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(data.description !== undefined ? { description: data.description ?? null } : {}),
      ...(data.sku !== undefined ? { sku: data.sku ?? null } : {}),
      ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
      ...(data.currency !== undefined ? { currency: data.currency } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.stockQuantity !== undefined ? { stockQuantity: data.stockQuantity } : {}),
      ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl ?? null } : {}),
    };

    if (data.priceCents !== undefined && data.priceCents !== existing.priceCents) {
      patch.marginBps = marginBps(data.priceCents, existing.currentCostCents);
    }

    const updated = await productRepository.update(organizationId, id, patch);
    if (!updated) throw new ProductNotFoundError();
    return updated;
  },

  /** Delete a product (media/variants/costs/metrics cascade at the DB). */
  async delete(organizationId: string, id: string) {
    const deleted = await productRepository.delete(organizationId, id);
    if (!deleted) throw new ProductNotFoundError();
  },

  count(organizationId: string) {
    return productRepository.count(organizationId);
  },

  /** Aggregate KPIs for the dashboard header (scoped). */
  async stats(organizationId: string) {
    const [total, active, aggregates] = await prisma.$transaction([
      prisma.product.count({ where: { organizationId } }),
      prisma.product.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.product.aggregate({
        where: { organizationId },
        _sum: { stockQuantity: true },
        _avg: { marginBps: true },
      }),
    ]);
    return {
      total,
      active,
      totalStock: aggregates._sum.stockQuantity ?? 0,
      avgMarginBps: Math.round(aggregates._avg.marginBps ?? 0),
    };
  },
};
