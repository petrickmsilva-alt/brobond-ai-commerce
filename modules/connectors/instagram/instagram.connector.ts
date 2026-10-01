import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";

export class InstagramConnectionRequiredError extends Error {
  constructor(
    message = "Connect an Instagram Business account before synchronizing this connector.",
  ) {
    super(message);
    this.name = "InstagramConnectionRequiredError";
  }
}

/**
 * Instagram Shopping adapter backed exclusively by the official Graph API
 * (PR012). Credentials come from the PR010 OAuth flow, mirrored onto the
 * unified Connector model; tokens rotate transparently before expiry.
 */
export class InstagramConnector implements Connector {
  readonly platform: ConnectorPlatform = ConnectorPlatform.INSTAGRAM;
  readonly name = "Instagram Shopping";
  readonly implemented = true;

  async fetchContent(options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    if (!options.organizationId) {
      throw new InstagramConnectionRequiredError(
        "Instagram Shopping sync requires an organization scope.",
      );
    }
    // Lazy import keeps Prisma out of any browser-adjacent module graph.
    const { fetchInstagramContent } =
      await import("@/modules/marketplace/instagram/instagram-bridge.service");
    return fetchInstagramContent(options.organizationId, options.limit ?? 50);
  }

  async testConnection(): Promise<ConnectorHealth> {
    const configured = Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
    return {
      platform: this.platform,
      ok: configured,
      implemented: true,
      message: configured
        ? "Integração oficial pronta. Conecte uma conta Instagram Business para validar as permissões."
        : "Configure META_APP_ID e META_APP_SECRET no servidor para conectar uma conta.",
    };
  }
}
