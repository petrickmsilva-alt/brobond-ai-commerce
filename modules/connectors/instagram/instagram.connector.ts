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

  /**
   * Complete Meta OAuth, capture the long-lived Page Access Token discovered
   * through /me/accounts and mirror it onto the unified Connector model. The
   * bridge applies AES-256-GCM with CONNECTOR_ENCRYPTION_KEY before the token
   * is persisted as an Instagram Shopping credential.
   */
  async exchangeAuthorizationCode(input: {
    code: string;
    state: string;
  }): Promise<{ organizationId: string; accountIds: string[] }> {
    const [{ exchangeCode }, { mirrorInstagramConnection }] = await Promise.all([
      import("@/modules/delivery/instagram/auth.service"),
      import("@/modules/marketplace/instagram/instagram-bridge.service"),
    ]);
    const accounts = await exchangeCode(input);
    const organizationId = accounts[0]?.organizationId;
    if (!organizationId) {
      throw new InstagramConnectionRequiredError(
        "Instagram OAuth completed without a linked Business account.",
      );
    }
    const mirrored = await mirrorInstagramConnection(organizationId);
    if (!mirrored) {
      throw new InstagramConnectionRequiredError(
        "Instagram credential could not be encrypted and persisted.",
      );
    }
    return { organizationId, accountIds: accounts.map((account) => account.accountId) };
  }

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
