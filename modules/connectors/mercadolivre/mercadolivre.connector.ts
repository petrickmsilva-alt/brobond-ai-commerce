import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";

export class MercadoLivreConnectionRequiredError extends Error {
  constructor(message = "Connect a Mercado Livre account before synchronizing this connector.") {
    super(message);
    this.name = "MercadoLivreConnectionRequiredError";
  }
}

/**
 * Mercado Livre adapter backed exclusively by the official Meli API
 * (PR012) — OAuth2 with transparent refresh-token rotation; credentials
 * are AES-256-GCM ciphertexts on the unified Connector model.
 */
export class MercadoLivreConnector implements Connector {
  readonly platform: ConnectorPlatform = ConnectorPlatform.MERCADOLIVRE;
  readonly name = "Mercado Livre";
  readonly implemented = true;

  async fetchContent(options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    if (!options.organizationId) {
      throw new MercadoLivreConnectionRequiredError(
        "Mercado Livre sync requires an organization scope.",
      );
    }
    // Lazy imports keep Prisma out of any browser-adjacent module graph.
    const [{ marketplaceService }, { fetchMercadoLivreItems }] = await Promise.all([
      import("@/modules/marketplace/core/connector.service"),
      import("@/modules/marketplace/mercadolivre/mercadolivre.service"),
    ]);
    const { accessToken, shopId } = await marketplaceService.getValidAccessToken(
      options.organizationId,
      "MERCADOLIVRE",
    );
    if (!shopId) throw new MercadoLivreConnectionRequiredError();
    return fetchMercadoLivreItems(accessToken, shopId, options.limit ?? 50);
  }

  async testConnection(): Promise<ConnectorHealth> {
    const configured = Boolean(
      process.env.MERCADOLIVRE_CLIENT_ID && process.env.MERCADOLIVRE_CLIENT_SECRET,
    );
    return {
      platform: this.platform,
      ok: configured,
      implemented: true,
      message: configured
        ? "Integração oficial pronta. Conecte uma conta Mercado Livre para validar as permissões."
        : "Configure MERCADOLIVRE_CLIENT_ID e MERCADOLIVRE_CLIENT_SECRET no servidor para conectar uma conta.",
    };
  }
}
