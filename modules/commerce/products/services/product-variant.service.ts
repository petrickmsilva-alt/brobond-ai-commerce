import "server-only";
import type { Prisma } from "@prisma/client";
import { productRepository } from "../repositories/product.repository";
import { productVariantRepository } from "../repositories/product-variant.repository";
import type { ProductVariantInput, UpdateProductVariantInput } from "../validators/product.schema";
import { productVariantSchema, updateProductVariantSchema } from "../validators/product.schema";
import { ProductNotFoundError } from "./product.service";

/**
 * ProductVariant service — sellable variations of a product.
 *
 * STOCK: whenever variant stock changes, the parent product's aggregate
 * `stockQuantity` is refreshed to the sum of active variant stock (products
 * without variants keep their own manually-managed stock).
 */
async function syncProductStock(organizationId: string, productId: string) {
  const variants = await productVariantRepository.listByProduct(organizationId, productId);
  if (variants.length === 0) return; // no variants → manual product stock stays

  const total = variants
    .filter((variant) => variant.isActive)
    .reduce((sum, variant) => sum + variant.stockQuantity, 0);

  await productRepository.update(organizationId, productId, { stockQuantity: total });
}

export const productVariantService = {
  list(organizationId: string, productId: string) {
    return productVariantRepository.listByProduct(organizationId, productId);
  },

  async add(organizationId: string, productId: string, input: ProductVariantInput) {
    const data = productVariantSchema.parse(input);

    const product = await productRepository.findById(organizationId, productId);
    if (!product) throw new ProductNotFoundError();

    const variant = await productVariantRepository.create(organizationId, {
      productId,
      name: data.name,
      sku: data.sku ?? null,
      priceCents: data.priceCents ?? null,
      costCents: data.costCents ?? null,
      stockQuantity: data.stockQuantity,
      isActive: data.isActive,
      position: data.position,
      attributes: data.attributes ?? undefined,
    });

    await syncProductStock(organizationId, productId);
    return variant;
  },

  async update(organizationId: string, variantId: string, input: UpdateProductVariantInput) {
    const data = updateProductVariantSchema.parse(input);

    const existing = await productVariantRepository.findById(organizationId, variantId);
    if (!existing) throw new ProductNotFoundError();

    const patch: Prisma.ProductVariantUncheckedUpdateInput = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.sku !== undefined ? { sku: data.sku ?? null } : {}),
      ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
      ...(data.costCents !== undefined ? { costCents: data.costCents } : {}),
      ...(data.stockQuantity !== undefined ? { stockQuantity: data.stockQuantity } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.position !== undefined ? { position: data.position } : {}),
      ...(data.attributes !== undefined ? { attributes: data.attributes } : {}),
    };

    const updated = await productVariantRepository.update(organizationId, variantId, patch);
    if (!updated) throw new ProductNotFoundError();

    await syncProductStock(organizationId, existing.productId);
    return updated;
  },

  async remove(organizationId: string, variantId: string) {
    const existing = await productVariantRepository.findById(organizationId, variantId);
    if (!existing) throw new ProductNotFoundError();

    await productVariantRepository.delete(organizationId, variantId);
    await syncProductStock(organizationId, existing.productId);
  },
};
