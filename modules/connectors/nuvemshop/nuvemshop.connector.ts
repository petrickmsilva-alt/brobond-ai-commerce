import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";

export class NuvemshopConnectionRequiredError extends Error {
  readonly requiresReauth = true;

  constructor(message = "Connect a Nuvemshop store before synchronizing this connector.") {
    super(message);
    this.name = "NuvemshopConnectionRequiredError";
  }
}

/**
 * Nuvemshop adapter backed by the official OAuth credential stored on the
 * unified Connector model. Orders are ingested by the webhook pipeline; this
 * adapter still participates in the generic connector framework so the
 * factory, health checks and platform-scoped content queries stay exhaustive.
 */
export class NuvemshopConnector implements Connector {
  readonly platform: ConnectorPlatform = ConnectorPlatform.NUVEMSHOP;
  readonly name = "Nuvemshop";
  readonly implemented = true;

  async fetchContent(options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    if (!options.organizationId) {
      throw new NuvemshopConnectionRequiredError("Nuvemshop sync requires an organization scope.");
    }

    const { marketplaceService } = await import("@/modules/marketplace/core/connector.service");
    const { shopId } = await marketplaceService.getValidAccessToken(
      options.organizationId,
      "NUVEMSHOP",
    );
    if (!shopId) throw new NuvemshopConnectionRequiredError();

    // Nuvemshop sales are normalized by the webhook ingestion path. There is
    // no ExternalContent catalog pull in this adapter yet, so a valid
    // credential produces an empty import batch instead of an unsupported
    // platform error.
    return [];
  }

  async testConnection(): Promise<ConnectorHealth> {
    const configured = Boolean(
      process.env.NUVEMSHOP_CLIENT_SECRET && process.env.NUVEMSHOP_REDIRECT_URI,
    );
    return {
      platform: this.platform,
      ok: configured,
      implemented: true,
      message: configured
        ? "Integração oficial pronta. Conecte uma loja Nuvemshop para validar as permissões."
        : "Configure NUVEMSHOP_CLIENT_SECRET e NUVEMSHOP_REDIRECT_URI no servidor para conectar uma loja.",
    };
  }
}
