import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import { TikTokApiClient, getTikTokApiConfig } from "./api/client";
import { getProducts } from "./api/products";
import { mapTikTokProduct } from "./sync/mapper";
import {
  hasMockTikTokCredentials,
  isTikTokAuthenticationError,
  throwTikTokPendingApproval,
} from "./pending-approval.service";
import {
  TIKTOK_SANDBOX_MESSAGE,
  getSimulatedSandboxProducts,
  isTikTokSandboxMode,
  markTikTokSandboxActive,
} from "./sandbox.service";
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
    if (hasMockTikTokCredentials()) {
      return throwTikTokPendingApproval(options.organizationId, "mock_credentials");
    }

    const sandbox = isTikTokSandboxMode();
    if (sandbox) {
      // Sandbox never raises "pending approval": the channel is mapped as
      // SANDBOX_ACTIVE (or the functional PENDING_APPROVAL fallback) and the
      // sync keeps running against TikTok test shops.
      await markTikTokSandboxActive(options.organizationId, "sandbox_sync").catch(() => {});
    }

    // Importing account/token services lazily keeps this adapter safe to
    // describe in generic connector UI without constructing Prisma in a
    // browser-adjacent module graph.
    const [{ tiktokTokenRepository }, { tiktokOAuthService }] = await Promise.all([
      import("./auth/token.service"),
      import("./auth/oauth.service"),
    ]);
    const accounts = await tiktokTokenRepository.findConnected(options.organizationId);
    if (accounts.length === 0) {
      if (sandbox) return [];
      throw new TikTokConnectionRequiredError();
    }

    const items: NormalizedContent[] = [];
    try {
      for (const account of accounts) {
        const token = await tiktokOAuthService.getValidAccessToken(options.organizationId, account);

        // Fully simulated sandbox session (no TikTok host reachable): serve
        // the deterministic test catalog instead of signing a real request.
        if (sandbox && token.startsWith("sandbox-access-")) {
          for (const product of getSimulatedSandboxProducts(account.shopId)) {
            items.push({
              externalId: `product:${account.shopId}:${product.productId}`,
              type: "PRODUCT",
              title: product.name,
              thumbnailUrl: product.imageUrl,
              caption: product.description,
              raw: {
                provider: "tiktok-shop",
                sandbox: true,
                shopId: account.shopId,
                productId: product.productId,
              },
            });
            if (options.limit && items.length >= options.limit) return items;
          }
          continue;
        }

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
    } catch (error) {
      if (sandbox) {
        // Authentication noise from the sandbox must not be reported as a
        // production approval failure; the channel simply has nothing to sync.
        if (isTikTokAuthenticationError(error)) return items;
        throw error;
      }
      if (isTikTokAuthenticationError(error)) {
        return throwTikTokPendingApproval(options.organizationId, "authentication_rejected", error);
      }
      throw error;
    }
  }

  async testConnection(): Promise<ConnectorHealth> {
    const configured = Boolean(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET);
    const sandbox = isTikTokSandboxMode();
    if (sandbox) {
      return {
        platform: this.platform,
        ok: configured,
        implemented: true,
        message: configured
          ? TIKTOK_SANDBOX_MESSAGE
          : "Configure TIKTOK_APP_KEY e TIKTOK_APP_SECRET (chaves de Sandbox) no servidor.",
      };
    }
    const awaitingApproval = hasMockTikTokCredentials();
    return {
      platform: this.platform,
      ok: configured && !awaitingApproval,
      implemented: true,
      message: awaitingApproval
        ? "Aguardando homologação e aprovação do cadastro da loja no TikTok Seller Center"
        : configured
          ? "Integração oficial pronta. Conecte uma conta TikTok Shop para validar as permissões."
          : "Configure TIKTOK_APP_KEY e TIKTOK_APP_SECRET no servidor para conectar uma conta.",
    };
  }
}
