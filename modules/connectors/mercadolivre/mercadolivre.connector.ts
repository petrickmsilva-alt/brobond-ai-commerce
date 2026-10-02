import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";

/** The one action that resolves every Mercado Livre authorization failure. */
const CONNECT_CTA = "Conectar Conta do Mercado Livre";

export class MercadoLivreConnectionRequiredError extends Error {
  /**
   * Read by `requiresReauthentication()` (marketplace errors module) so the
   * dashboard renders the connect call to action instead of a retry.
   */
  readonly requiresReauth = true;

  constructor(
    message = `A conta do Mercado Livre ainda não foi autorizada. Clique em "${CONNECT_CTA}" para liberar o acesso aos seus anúncios.`,
  ) {
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
    const [{ marketplaceService }, { fetchMercadoLivreItems, hasMercadoLivreAuthorization }] =
      await Promise.all([
        import("@/modules/marketplace/core/connector.service"),
        import("@/modules/marketplace/mercadolivre/mercadolivre.service"),
      ]);
    const { accessToken, shopId } = await marketplaceService.getValidAccessToken(
      options.organizationId,
      "MERCADOLIVRE",
    );
    // No usable credential ⇒ never call the API. Listing anúncios with an
    // empty bearer returned an opaque 401 that the panel showed as "Não foi
    // possível listar os anúncios do Mercado Livre"; the operator now reads
    // the action that actually fixes it (PR016.1).
    if (!hasMercadoLivreAuthorization(accessToken, shopId)) {
      throw new MercadoLivreConnectionRequiredError();
    }
    return fetchMercadoLivreItems(accessToken, shopId as string, options.limit ?? 50);
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
