import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";

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

  async fetchContent(options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    if (!options.organizationId) {
      throw new ShopeeConnectionRequiredError("Shopee sync requires an organization scope.");
    }
    // Lazy imports keep Prisma out of any browser-adjacent module graph.
    const [{ marketplaceService }, { fetchShopeeProducts }] = await Promise.all([
      import("@/modules/marketplace/core/connector.service"),
      import("@/modules/marketplace/shopee/shopee.service"),
    ]);
    const { accessToken, shopId } = await marketplaceService.getValidAccessToken(
      options.organizationId,
      "SHOPEE",
    );
    if (!shopId) throw new ShopeeConnectionRequiredError();
    return fetchShopeeProducts(accessToken, shopId, options.limit ?? 50);
  }

  async testConnection(): Promise<ConnectorHealth> {
    const configured = Boolean(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY);
    return {
      platform: this.platform,
      ok: configured,
      implemented: true,
      message: configured
        ? "Integração oficial pronta. Conecte uma loja Shopee para validar as permissões."
        : "Configure SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no servidor para conectar uma loja.",
    };
  }
}
