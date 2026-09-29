/**
 * Instagram Connector — PLACEHOLDER (PR005).
 *
 * Reserved for the real Instagram source (a future PR): Graph API /
 * Instagram Basic Display. The contract is already pinned here and tested,
 * so wiring the real implementation must not touch any caller —
 * `getConnector(ConnectorPlatform.INSTAGRAM)` keeps resolving to this class
 * until then.
 *
 * NO network access, NO SDK, NO credentials are used in PR005 — by design.
 * When the real adapter lands it must:
 *   1. read its secret through a server-only secret reference (never a raw
 *      token in the database, never in the client bundle);
 *   2. map the provider payload onto `NormalizedContent` inside this file,
 *      so nothing downstream learns the provider's shape;
 *   3. flip `implemented` to `true` — the dashboard and the sync service
 *      key off that flag, not off try/catch.
 */

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";
import { ConnectorNotImplementedError, placeholderHealth } from "../core/connector.interface";

export class InstagramConnector implements Connector {
  readonly platform: ConnectorPlatform = ConnectorPlatform.INSTAGRAM;
  readonly name = "Instagram Connector";
  readonly implemented = false;

  async fetchContent(_options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    void _options;
    throw new ConnectorNotImplementedError(this.platform);
  }

  async testConnection(): Promise<ConnectorHealth> {
    return placeholderHealth(this.platform, this.name);
  }
}
