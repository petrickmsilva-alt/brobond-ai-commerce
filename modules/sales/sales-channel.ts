/**
 * Sales Channel registry — PR013 (Hub Multicanal de Vendas).
 *
 * Single source of truth for WHICH revenue channels exist and how each is
 * labelled across Orders/Analytics/UI. Mirrors the Prisma `SaleChannel`
 * enum (`prisma/schema.prisma`) 1:1 with `BROBOND` + every
 * `ConnectorProvider` so a sale synced from a connector can be tagged with
 * the exact marketplace it came from.
 *
 * CLIENT-SAFE on purpose: no `@prisma/client` runtime import, no
 * `process.env` read — client components (badges, filters, sidebar deep
 * links) import this registry directly.
 */

import type { ConnectorProviderName } from "@/modules/marketplace/core/providers";

export const SALE_CHANNELS = [
  "BROBOND",
  "TIKTOK",
  "INSTAGRAM",
  "SHOPEE",
  "NUVEMSHOP",
  "MERCADOLIVRE",
  "MERCADOPAGO",
] as const;

export type SaleChannelName = (typeof SALE_CHANNELS)[number];

/** pt-BR display label for every channel, used by Orders and Analytics. */
export const SALE_CHANNEL_LABELS: Record<SaleChannelName, string> = {
  BROBOND: "Brobond (loja própria)",
  TIKTOK: "TikTok Shop",
  INSTAGRAM: "Instagram Shopping",
  SHOPEE: "Shopee",
  NUVEMSHOP: "Nuvemshop",
  MERCADOLIVRE: "Mercado Livre",
  MERCADOPAGO: "Mercado Pago",
};

/** Compact label for dense table cells and badges. */
export const SALE_CHANNEL_SHORT_LABELS: Record<SaleChannelName, string> = {
  BROBOND: "Brobond",
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  SHOPEE: "Shopee",
  NUVEMSHOP: "Nuvemshop",
  MERCADOLIVRE: "Mercado Livre",
  MERCADOPAGO: "Mercado Pago",
};

/** Badge tone per channel — keeps Orders/Analytics visually consistent. */
export const SALE_CHANNEL_BADGE_TONE: Record<
  SaleChannelName,
  "brand" | "neutral" | "success" | "warning" | "accent" | "info"
> = {
  BROBOND: "brand",
  TIKTOK: "neutral",
  INSTAGRAM: "accent",
  SHOPEE: "warning",
  NUVEMSHOP: "info",
  MERCADOLIVRE: "info",
  MERCADOPAGO: "success",
};

export const DEFAULT_SALE_CHANNEL: SaleChannelName = "BROBOND";

export function isSaleChannelName(value: unknown): value is SaleChannelName {
  return typeof value === "string" && (SALE_CHANNELS as readonly string[]).includes(value);
}

/**
 * A synced marketplace order's channel is identical to its connector
 * provider — the enums were designed 1:1 so this mapping can never drift.
 */
export function saleChannelFromConnectorProvider(provider: ConnectorProviderName): SaleChannelName {
  return provider;
}
