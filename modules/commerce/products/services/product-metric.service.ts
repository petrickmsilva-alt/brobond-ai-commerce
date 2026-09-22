import "server-only";
import { productMetricRepository } from "../repositories/product-metric.repository";
import { productRepository } from "../repositories/product.repository";
import type { ProductMetricInput } from "../validators/product.schema";
import { productMetricSchema } from "../validators/product.schema";
import { ProductNotFoundError } from "./product.service";

/**
 * ProductMetric service — daily performance metrics per product.
 * Upserts are idempotent per `(productId, date)` so an ingestion job
 * (PR006 analytics / integrations) can safely re-run.
 */
export const productMetricService = {
  list(organizationId: string, productId: string, take = 30) {
    return productMetricRepository.listByProduct(organizationId, productId, take);
  },

  async record(organizationId: string, productId: string, input: ProductMetricInput) {
    const data = productMetricSchema.parse(input);

    const product = await productRepository.findById(organizationId, productId);
    if (!product) throw new ProductNotFoundError();

    // Normalize to a date-only value (column is DATE).
    const day = new Date(
      Date.UTC(data.date.getUTCFullYear(), data.date.getUTCMonth(), data.date.getUTCDate()),
    );

    return productMetricRepository.upsert(organizationId, productId, day, {
      views: data.views,
      clicks: data.clicks,
      conversions: data.conversions,
      unitsSold: data.unitsSold,
      revenueCents: data.revenueCents,
    });
  },
};
