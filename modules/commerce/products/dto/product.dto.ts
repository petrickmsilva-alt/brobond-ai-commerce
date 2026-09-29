import type {
  Product,
  ProductCost,
  ProductMedia,
  ProductMetric,
  ProductStatus,
  ProductVariant,
} from "@prisma/client";

/**
 * DTOs — the shapes the products module exposes to the UI layer.
 *
 * Server components receive these objects and may pass them to client
 * components; they never contain secret material or cross-tenant data.
 */

/** Row shape consumed by the dashboard products table. */
export interface ProductListItemDTO {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  status: ProductStatus;
  priceCents: number;
  currency: string;
  currentCostCents: number;
  marginBps: number;
  stockQuantity: number;
  imageUrl: string | null;
  variantCount: number;
  createdAt: string; // ISO — serializable across the RSC boundary
  updatedAt: string;
}

/** Paginated result envelope for the dashboard table. */
export interface ProductPageDTO {
  items: ProductListItemDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Full detail shape (product + relations). */
export type ProductDetail = Product & {
  media: ProductMedia[];
  variants: ProductVariant[];
  costs: ProductCost[];
  metrics: ProductMetric[];
};

/** Uniform result for server actions (success or field/form errors). */
export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function toListItemDTO(
  product: Product & { _count?: { variants: number } },
): ProductListItemDTO {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    status: product.status,
    priceCents: product.priceCents,
    currency: product.currency,
    currentCostCents: product.currentCostCents,
    marginBps: product.marginBps,
    stockQuantity: product.stockQuantity,
    imageUrl: product.imageUrl,
    variantCount: product._count?.variants ?? 0,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
