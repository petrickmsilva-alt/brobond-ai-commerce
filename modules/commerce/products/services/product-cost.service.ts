import "server-only";
import { productCostRepository } from "../repositories/product-cost.repository";
import { productRepository } from "../repositories/product.repository";
import type { ProductCostInput } from "../validators/product.schema";
import { productCostSchema } from "../validators/product.schema";
import { ProductNotFoundError, recalculatePricing } from "./product.service";

/**
 * ProductCost service — cost snapshots + automatic margin recalculation.
 *
 * Every cost mutation triggers `recalculatePricing`, which refreshes the
 * denormalized `Product.currentCostCents` / `Product.marginBps` columns so
 * the dashboard can sort and filter by margin at the database level.
 */
export const productCostService = {
  list(organizationId: string, productId: string) {
    return productCostRepository.listByProduct(organizationId, productId);
  },

  current(organizationId: string, productId: string) {
    return productCostRepository.findCurrent(organizationId, productId);
  },

  async add(organizationId: string, productId: string, input: ProductCostInput) {
    const data = productCostSchema.parse(input);

    const product = await productRepository.findById(organizationId, productId);
    if (!product) throw new ProductNotFoundError();

    const cost = await productCostRepository.create(organizationId, {
      productId,
      unitCents: data.unitCents,
      freightCents: data.freightCents,
      packagingCents: data.packagingCents,
      feesCents: data.feesCents,
      otherCents: data.otherCents,
      currency: data.currency,
      note: data.note ?? null,
      ...(data.effectiveFrom ? { effectiveFrom: data.effectiveFrom } : {}),
    });

    await recalculatePricing(organizationId, productId);
    return cost;
  },

  async remove(organizationId: string, costId: string) {
    const cost = await productCostRepository.findById(organizationId, costId);
    if (!cost) throw new ProductNotFoundError();

    await productCostRepository.delete(organizationId, costId);
    await recalculatePricing(organizationId, cost.productId);
  },
};
