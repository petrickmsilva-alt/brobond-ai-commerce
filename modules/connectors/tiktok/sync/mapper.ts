import type { Prisma } from "@prisma/client";
import type { CreateExternalContentDTO } from "../../core/connector.dto";
import type { TikTokCreator } from "../api/creators";
import type { TikTokProduct, TikTokProductSku } from "../api/products";

export interface TikTokProductImport {
  tiktokProductId: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
  stockQuantity: number;
  status: "ACTIVE" | "DRAFT";
}

export interface TikTokCreatorImport {
  externalId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followers: number;
  avgViews: number;
  engagementRate: number;
  niche: string;
  creatorScore: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function nonNegativeInt(...values: unknown[]): number {
  for (const value of values) {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(numeric) && numeric >= 0) return Math.round(numeric);
  }
  return 0;
}

/** Converts decimal provider prices to integer minor units without floating point drift. */
export function decimalToCents(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.round((value + Number.EPSILON) * 100);
  }
  if (typeof value !== "string") return 0;
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return 0;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

function firstSku(product: TikTokProduct): TikTokProductSku | undefined {
  return Array.isArray(product.skus) ? product.skus[0] : undefined;
}

function productImage(product: TikTokProduct): string | null {
  const candidate = [...(product.images ?? []), ...(product.main_images ?? [])][0];
  if (!candidate) return null;
  return candidate.url ?? candidate.urls?.[0] ?? null;
}

function priceFromSku(sku: TikTokProductSku | undefined): { priceCents: number; currency: string } {
  if (!sku) return { priceCents: 0, currency: "BRL" };
  const price = record(sku.price);
  // `amount`/`cent_amount` are documented integer minor units; string price
  // fields are decimal major units. Keeping the distinction prevents a 100x
  // pricing corruption during import.
  const minor = nonNegativeInt(price.amount, price.cent_amount, price.price_cent, sku.amount);
  const decimal = stringValue(sku.sales_price, price.sale_price, price.price, sku.price);
  return {
    priceCents: minor || decimalToCents(decimal),
    currency: stringValue(sku.currency, price.currency) ?? "BRL",
  };
}

/** Maps an official Product API payload to our internal Product aggregate. */
export function mapTikTokProduct(product: TikTokProduct): TikTokProductImport {
  const id = stringValue(product.product_id, product.id);
  if (!id) throw new Error("TikTok product payload is missing product_id.");
  const sku = firstSku(product);
  const price = priceFromSku(sku);
  const status = stringValue(product.status)?.toUpperCase();
  return {
    tiktokProductId: id,
    name: stringValue(product.title, product.name) ?? `TikTok product ${id}`,
    // Stable external identity makes the slug collision-free inside a tenant.
    slug: `tiktok-${
      id
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "product"
    }`,
    description: stringValue(product.description) ?? null,
    sku: `tiktok-${id}`,
    priceCents: price.priceCents,
    currency: price.currency,
    imageUrl: productImage(product),
    stockQuantity: nonNegativeInt(sku?.stock_info?.available_stock),
    status: status === "ACTIVATED" || status === "ACTIVE" ? "ACTIVE" : "DRAFT",
  };
}

/**
 * Products are also normalized as ExternalContent (type PRODUCT), preserving
 * the existing connector dashboard's content stream while Product remains the
 * commercial source of truth.
 */
export function mapTikTokProductExternalContent(
  product: TikTokProduct,
  shopId: string,
): CreateExternalContentDTO {
  const mapped = mapTikTokProduct(product);
  return {
    platform: "TIKTOK",
    externalId: `product:${shopId}:${mapped.tiktokProductId}`,
    type: "PRODUCT",
    status: "IMPORTED",
    title: mapped.name,
    url: undefined,
    thumbnailUrl: mapped.imageUrl ?? undefined,
    authorHandle: undefined,
    caption: mapped.description ?? undefined,
    views: 0,
    likes: 0,
    shares: 0,
    raw: {
      provider: "tiktok-shop",
      shopId,
      productId: mapped.tiktokProductId,
      productStatus: stringValue(product.status) ?? null,
    } as Prisma.InputJsonValue,
  };
}

/** Maps an official Affiliate Seller creator payload to CreatorProfile. */
export function mapTikTokCreator(creator: TikTokCreator): TikTokCreatorImport {
  const externalId = stringValue(creator.creator_id, creator.id, creator.open_id);
  if (!externalId) throw new Error("TikTok creator payload is missing a creator identifier.");
  const rawHandle = stringValue(creator.handle, creator.username) ?? `tiktok-${externalId}`;
  const handle = rawHandle.replace(/^@+/, "").trim() || `tiktok-${externalId}`;
  const followers = nonNegativeInt(creator.follower_count, creator.followers);
  const avgViews = nonNegativeInt(creator.average_video_views, creator.avg_views);
  const engagement = Math.max(0, Number(creator.engagement_rate ?? 0) || 0);
  // A transparent bounded score used only as the initial import value. CRM
  // users retain their workflow status; later scoring can update this field.
  const creatorScore = Math.min(
    100,
    Math.round(
      Math.min(60, Math.log10(Math.max(1, followers)) * 10) +
        Math.min(25, engagement * 2) +
        (avgViews > 0 ? 15 : 0),
    ),
  );
  return {
    externalId,
    handle,
    displayName: stringValue(creator.display_name, creator.nickname, creator.username) ?? handle,
    avatarUrl: stringValue(creator.avatar_url) ?? null,
    bio: stringValue(creator.bio) ?? null,
    followers,
    avgViews,
    engagementRate: engagement,
    niche: stringValue(creator.category) ?? "TikTok Shop",
    creatorScore,
  };
}
