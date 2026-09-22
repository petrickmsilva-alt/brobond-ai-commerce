import { z } from "zod";
import { ProductMediaType, ProductStatus } from "@prisma/client";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./slug";

/**
 * Zod validation — single source of truth for every Product write path
 * (server actions, forms, future API routes). All money fields are integer
 * cents; all schemas reject unknown keys implicitly (Zod strips them).
 *
 * `organizationId` is NEVER part of any input schema: the tenant is always
 * resolved server-side from the session (`requireOrganization()`), never
 * accepted from the client.
 */

const centsSchema = z
  .number({ invalid_type_error: "Informe um valor numérico." })
  .int("Use um valor inteiro em centavos.")
  .min(0, "O valor não pode ser negativo.")
  .max(1_000_000_000, "Valor acima do limite suportado.");

const stockSchema = z
  .number({ invalid_type_error: "Informe um número." })
  .int("O estoque deve ser um número inteiro.")
  .min(0, "O estoque não pode ser negativo.")
  .max(100_000_000, "Estoque acima do limite suportado.");

export const productStatusSchema = z.nativeEnum(ProductStatus);

/** Treat "" (empty form field) as absent before validating. */
function emptyToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema,
  );
}

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(SLUG_MAX_LENGTH, `O slug deve ter no máximo ${SLUG_MAX_LENGTH} caracteres.`)
  .regex(SLUG_PATTERN, "Slug inválido: use apenas letras minúsculas, números e hífens.");

// ------------------------------------------------------------------
// Product
// ------------------------------------------------------------------

export const createProductSchema = z.object({
  name: z.string().trim().min(2, "O nome deve ter ao menos 2 caracteres.").max(160),
  /** Optional — when omitted the slug is derived automatically from the name. */
  slug: slugSchema.optional(),
  description: emptyToUndefined(z.string().trim().max(5000).optional()),
  sku: emptyToUndefined(z.string().trim().max(64).optional()),
  priceCents: centsSchema.default(0),
  currency: z.string().trim().length(3).toUpperCase().default("BRL"),
  status: productStatusSchema.default(ProductStatus.DRAFT),
  stockQuantity: stockSchema.default(0),
  imageUrl: emptyToUndefined(z.string().trim().url("Informe uma URL válida.").optional()),
});

export const updateProductSchema = createProductSchema.partial();

export type CreateProductInput = z.input<typeof createProductSchema>;
export type UpdateProductInput = z.input<typeof updateProductSchema>;

// ------------------------------------------------------------------
// ProductMedia
// ------------------------------------------------------------------

export const productMediaSchema = z.object({
  type: z.nativeEnum(ProductMediaType).default(ProductMediaType.IMAGE),
  url: z.string().trim().url("Informe uma URL válida."),
  altText: emptyToUndefined(z.string().trim().max(300).optional()),
  position: z.number().int().min(0).default(0),
  isPrimary: z.boolean().default(false),
});

export type ProductMediaInput = z.input<typeof productMediaSchema>;

// ------------------------------------------------------------------
// ProductVariant
// ------------------------------------------------------------------

export const productVariantSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da variação.").max(120),
  sku: emptyToUndefined(z.string().trim().max(64).optional()),
  priceCents: centsSchema.nullish(),
  costCents: centsSchema.nullish(),
  stockQuantity: stockSchema.default(0),
  isActive: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
  attributes: z.record(z.string(), z.string()).optional(),
});

export const updateProductVariantSchema = productVariantSchema.partial();

export type ProductVariantInput = z.input<typeof productVariantSchema>;
export type UpdateProductVariantInput = z.input<typeof updateProductVariantSchema>;

// ------------------------------------------------------------------
// ProductCost
// ------------------------------------------------------------------

export const productCostSchema = z.object({
  unitCents: centsSchema,
  freightCents: centsSchema.default(0),
  packagingCents: centsSchema.default(0),
  feesCents: centsSchema.default(0),
  otherCents: centsSchema.default(0),
  currency: z.string().trim().length(3).toUpperCase().default("BRL"),
  note: emptyToUndefined(z.string().trim().max(500).optional()),
  effectiveFrom: z.coerce.date().optional(),
});

export type ProductCostInput = z.input<typeof productCostSchema>;

// ------------------------------------------------------------------
// ProductMetric
// ------------------------------------------------------------------

export const productMetricSchema = z.object({
  date: z.coerce.date(),
  views: z.number().int().min(0).default(0),
  clicks: z.number().int().min(0).default(0),
  conversions: z.number().int().min(0).default(0),
  unitsSold: z.number().int().min(0).default(0),
  revenueCents: centsSchema.default(0),
});

export type ProductMetricInput = z.input<typeof productMetricSchema>;

// ------------------------------------------------------------------
// Dashboard list query (pagination + filters + search + sort)
// ------------------------------------------------------------------

export const PRODUCT_PAGE_SIZE_DEFAULT = 10;
export const PRODUCT_PAGE_SIZE_MAX = 50;

export const productSortFields = [
  "createdAt",
  "name",
  "priceCents",
  "marginBps",
  "stockQuantity",
] as const;

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PRODUCT_PAGE_SIZE_MAX)
    .catch(PRODUCT_PAGE_SIZE_DEFAULT)
    .default(PRODUCT_PAGE_SIZE_DEFAULT),
  /** Free-text search over name, slug and SKU. */
  search: z.string().trim().max(160).optional().catch(undefined),
  status: productStatusSchema.optional().catch(undefined),
  /** Margin filter in basis points. */
  minMarginBps: z.coerce.number().int().optional().catch(undefined),
  maxMarginBps: z.coerce.number().int().optional().catch(undefined),
  /** Price filter in cents. */
  minPriceCents: z.coerce.number().int().min(0).optional().catch(undefined),
  maxPriceCents: z.coerce.number().int().min(0).optional().catch(undefined),
  /** Stock filter. */
  inStock: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
    .catch(undefined),
  sort: z.enum(productSortFields).catch("createdAt").default("createdAt"),
  order: z.enum(["asc", "desc"]).catch("desc").default("desc"),
});

export type ProductListQuery = z.output<typeof productListQuerySchema>;
export type ProductListQueryInput = z.input<typeof productListQuerySchema>;
