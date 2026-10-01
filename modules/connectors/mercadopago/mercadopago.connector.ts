import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";

export class MercadoPagoConnectionRequiredError extends Error {
  constructor(
    message = "Connect a Mercado Pago seller account before synchronizing this connector.",
  ) {
    super(message);
    this.name = "MercadoPagoConnectionRequiredError";
  }
}

/**
 * Mercado Pago adapter backed exclusively by the official payments API
 * (PR012). The seller's production Access Token is validated on connect and
 * persisted encrypted on the unified Connector model; syncs pull the live
 * checkout billing feed (`/v1/payments/search`).
 */
export class MercadoPagoConnector implements Connector {
  readonly platform: ConnectorPlatform = ConnectorPlatform.MERCADOPAGO;
  readonly name = "Mercado Pago";
  readonly implemented = true;

  async fetchContent(options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    if (!options.organizationId) {
      throw new MercadoPagoConnectionRequiredError(
        "Mercado Pago sync requires an organization scope.",
      );
    }
    // Lazy imports keep Prisma out of any browser-adjacent module graph.
    const [{ marketplaceService }, { fetchMercadoPagoPayments }] = await Promise.all([
      import("@/modules/marketplace/core/connector.service"),
      import("@/modules/marketplace/mercadopago/mercadopago.service"),
    ]);
    const { accessToken } = await marketplaceService.getValidAccessToken(
      options.organizationId,
      "MERCADOPAGO",
    );
    return fetchMercadoPagoPayments(accessToken, options.limit ?? 50);
  }

  async testConnection(): Promise<ConnectorHealth> {
    return {
      platform: this.platform,
      ok: true,
      implemented: true,
      message:
        "Integração oficial pronta. Informe o Access Token e a Public Key de produção da conta de vendedor para conectar.",
    };
  }
}
