import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";
import { getShopeeConfig } from "@/modules/marketplace/shopee/shopee.service";

export class ShopeeConnectionRequiredError extends Error {
  constructor(message = "Connect a Shopee shop before synchronizing this connector.") {
    super(message);
    this.name = "ShopeeConnectionRequiredError";
  }
}

/**
 * Shopee adapter backed exclusively by the official Open Platform v2
 * (PR012) — HMAC-SHA256 signed requests, OAuth2 tokens persisted encrypted
 * on the unified Connector model and rotated transparently before expiry.
 */
export class ShopeeConnector implements Connector {
  readonly platform: ConnectorPlatform = ConnectorPlatform.SHOPEE;
  readonly name = "Shopee";
  readonly implemented = true;

  /**
   * Exchange the Open Platform authorization code and persist both returned
   * tokens through the unified marketplace service. That service encrypts
   * each value with CONNECTOR_ENCRYPTION_KEY before its PostgreSQL upsert.
   */
  async exchangeAuthorizationCode(
    organizationId: string,
    code: string,
    shopId: string,
  ): Promise<void> {
    if (!organizationId.trim()) {
      throw new ShopeeConnectionRequiredError(
        "Shopee authorization requires an organization scope.",
      );
    }
    // Production environment lock. The OAuth exchange is HMAC-SHA256 signed
    // only with the official Partner ID/key configured on Render; there is no
    // fallback or simplified mode.
    getShopeeConfig();
    const { marketplaceService } = await import("@/modules/marketplace/core/connector.service");
    await marketplaceService.handleShopeeCallback(organizationId, { code, shop_id: shopId });
  }

  /**
   * Pull the live Shopee catalog and idempotently upsert every item into the
   * tenant's Product table. The provider identity, rather than mutable SKU,
   * is the conflict key, so renames and price/stock updates never duplicate a
   * product and can never cross tenant boundaries.
   */
  async syncProducts(organizationId: string, limit = 50): Promise<NormalizedContent[]> {
    if (!organizationId.trim()) {
      throw new ShopeeConnectionRequiredError("Shopee sync requires an organization scope.");
    }
    // Resolve and validate both mandatory Render secrets before reading a
    // seller token or issuing a catalog request. `fetchShopeeProducts()` uses
    // this exact config to HMAC-SHA256 sign the official Open Platform call.
    const shopeeConfig = getShopeeConfig();
    const [{ prisma }, { marketplaceService }, { fetchShopeeProducts }] = await Promise.all([
      import("@/lib/prisma"),
      import("@/modules/marketplace/core/connector.service"),
      import("@/modules/marketplace/shopee/shopee.service"),
    ]);
    const { accessToken, shopId } = await marketplaceService.getValidAccessToken(
      organizationId,
      "SHOPEE",
    );
    if (!shopId) throw new ShopeeConnectionRequiredError();

    const items = await fetchShopeeProducts(accessToken, shopId, limit, shopeeConfig);
    await Promise.all(
      items.map(async (item) => {
        const raw = item.raw ?? {};
        const itemId = String(raw.itemId ?? "").trim();
        if (!itemId) return;
        const shopeeProductId = `${shopId}:${itemId}`;
        const numericPrice = typeof raw.price === "number" ? raw.price : Number(raw.price ?? 0);
        const priceCents = Number.isFinite(numericPrice)
          ? Math.max(0, Math.round(numericPrice * 100))
          : 0;
        const numericStock =
          typeof raw.stockQuantity === "number"
            ? raw.stockQuantity
            : Number(raw.stockQuantity ?? 0);
        const stockQuantity = Number.isFinite(numericStock)
          ? Math.max(0, Math.trunc(numericStock))
          : 0;
        const data = {
          name: item.title,
          slug: `shopee-${shopId}-${itemId}`.toLowerCase(),
          description: item.caption ?? null,
          sku: `shopee:${shopId}:${itemId}`,
          priceCents,
          currency: typeof raw.currency === "string" ? raw.currency : "BRL",
          imageUrl: item.thumbnailUrl ?? null,
          stockQuantity,
          status: "ACTIVE" as const,
        };
        await prisma.product.upsert({
          where: {
            organizationId_shopeeProductId: { organizationId, shopeeProductId },
          },
          update: data,
          create: { ...data, organizationId, shopeeProductId },
        });
      }),
    );
    return items;
  }

  async fetchContent(options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    if (!options.organizationId) {
      throw new ShopeeConnectionRequiredError("Shopee sync requires an organization scope.");
    }
    return this.syncProducts(options.organizationId, options.limit ?? 50);
  }

  async testConnection(): Promise<ConnectorHealth> {
    try {
      // Uses the same strict parser as OAuth and sync (positive integer
      // partner id + non-empty partner key), rather than a truthy env probe.
      getShopeeConfig();
      return {
        platform: this.platform,
        ok: true,
        implemented: true,
        message: "Integração oficial pronta. Conecte uma loja Shopee para validar as permissões.",
      };
    } catch {
      return {
        platform: this.platform,
        ok: false,
        implemented: true,
        message:
          "Configure SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no servidor para conectar uma loja.",
      };
    }
  }
}
