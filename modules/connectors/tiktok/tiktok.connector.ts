import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import { TikTokApiClient, getTikTokApiConfig } from "./api/client";
import { getProducts } from "./api/products";
import { mapTikTokProduct } from "./sync/mapper";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";

export class TikTokConnectionRequiredError extends Error {
  constructor(message = "Connect a TikTok Shop account before synchronizing this connector.") {
    super(message);
    this.name = "TikTokConnectionRequiredError";
  }
}

/**
 * TikTok Shop adapter backed exclusively by the official Shop API. The generic
 * connector framework imports normalized PRODUCT ExternalContent; the richer
 * PR009 importer additionally writes Product and CreatorProfile records.
 */
export class TikTokConnector implements Connector {
  readonly platform: ConnectorPlatform = ConnectorPlatform.TIKTOK;
  readonly name = "TikTok Shop";
  readonly implemented = true;

  async fetchContent(options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    if (!options.organizationId) {
      throw new TikTokConnectionRequiredError("TikTok Shop sync requires an organization scope.");
    }
    // Importing account/token services lazily keeps this adapter safe to
    // describe in generic connector UI without constructing Prisma in a
    // browser-adjacent module graph.
    const [{ tiktokTokenRepository }, { tiktokOAuthService }] = await Promise.all([
      import("./auth/token.service"),
      import("./auth/oauth.service"),
    ]);
    const accounts = await tiktokTokenRepository.findConnected(options.organizationId);
    if (accounts.length === 0) throw new TikTokConnectionRequiredError();

    const items: NormalizedContent[] = [];
    for (const account of accounts) {
      const token = await tiktokOAuthService.getValidAccessToken(options.organizationId, account);
      const response = await getProducts(new TikTokApiClient(getTikTokApiConfig()), {
        accessToken: token,
        shopCipher: account.shopCipher,
        pageSize: Math.min(options.limit ?? 100, 100),
      });
      for (const product of response.products) {
        const mapped = mapTikTokProduct(product);
        items.push({
          externalId: `product:${account.shopId}:${mapped.tiktokProductId}`,
          type: "PRODUCT",
          title: mapped.name,
          thumbnailUrl: mapped.imageUrl ?? undefined,
          caption: mapped.description ?? undefined,
          raw: {
            provider: "tiktok-shop",
            shopId: account.shopId,
            productId: mapped.tiktokProductId,
          },
        });
        if (options.limit && items.length >= options.limit) return items;
      }
    }
    return items;
  }

  async testConnection(): Promise<ConnectorHealth> {
    return {
      platform: this.platform,
      ok: Boolean(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET),
      implemented: true,
      message:
        process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET
          ? "Integração oficial pronta. Conecte uma conta TikTok Shop para validar as permissões."
          : "Configure TIKTOK_APP_KEY e TIKTOK_APP_SECRET no servidor para conectar uma conta.",
    };
  }
}
