import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "This service does not exist" regression — the TikTok Connector button.
 *
 * The panel used to send operators to the COMMERCIAL TikTok Shop seller
 * gateway (`services.tiktokshop.com/open/authorize`, parameterized with
 * `service_id`). This app is not registered against that product, so TikTok
 * answered "this service does not exist" and the connection never started.
 *
 * `startOAuth("TIKTOK")` must now mint the consumer/creator **Login Kit v2**
 * consent URL on `tiktok.com`, carrying exactly the contract saved in our
 * Sandbox profile: `client_key`, `scope=user.info.stats`,
 * `response_type=code`, the registered localhost `redirect_uri` and `state`.
 *
 * Both TikTok affordances in the UI (the connectors grid card and the
 * /dashboard/tiktok button) funnel through this one seam, so pinning it here
 * pins the behaviour of every connect button in the product.
 */

const ISSUED_STATE = "state-that-is-long-and-unpredictable-1234567890";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
// Enums only: this suite asserts a URL contract, never a query. Mirrors the
// stubbing already used by the other connector suites so the tests run
// without a generated Prisma client.
vi.mock("@prisma/client", () => ({
  UserRole: { ADMIN: "ADMIN", MANAGER: "MANAGER", MEMBER: "MEMBER" },
  ConnectorPlatform: { TIKTOK: "TIKTOK" },
  ConnectorProvider: { TIKTOK: "TIKTOK" },
  ConnectionStatus: { CONNECTED: "CONNECTED", DISCONNECTED: "DISCONNECTED" },
}));
vi.mock("@/modules/marketplace/core/oauth-state.service", () => ({
  connectorOAuthStateService: {
    issue: vi.fn(async () => ISSUED_STATE),
    consume: vi.fn(),
  },
}));
vi.mock("@/modules/marketplace/tiktok/tiktok-bridge.service", () => ({
  mirrorTikTokConnection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/marketplace/instagram/instagram-bridge.service", () => ({
  mirrorInstagramConnection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/delivery/instagram/auth.service", () => ({
  connectInstagram: vi.fn(),
}));

import {
  TIKTOK_LOGIN_STATE_COOKIE,
  TIKTOK_LOGIN_STATE_TTL_SECONDS,
} from "@/modules/connectors/tiktok/auth/login-kit.config";
import { createMarketplaceService } from "@/modules/marketplace/core/connector.service";

beforeEach(() => {
  process.env.TIKTOK_CLIENT_KEY = "sbawkey123";
  process.env.TIKTOK_CLIENT_SECRET = "sbawsecret456";
  process.env.TIKTOK_REDIRECT_URI = "http://localhost:3000/api/connectors/tiktok/callback";
});

describe("TikTok connector button — authorization URL", () => {
  it("targets the tiktok.com Login Kit v2 gateway, never the Shop seller one", async () => {
    const service = createMarketplaceService();
    const { authorizationUrl } = await service.startOAuth("org-1", "TIKTOK");
    const url = new URL(authorizationUrl);

    expect(url.protocol).toBe("https:");
    expect(url.hostname.endsWith("tiktok.com")).toBe(true);
    expect(authorizationUrl).not.toContain("tiktokshop.com");
    // `service_id` is the TikTok Shop seller parameter — it must not survive.
    expect(url.searchParams.get("service_id")).toBeNull();
  });

  it("carries the exact parameter contract saved in the Sandbox profile", async () => {
    const service = createMarketplaceService();
    const { authorizationUrl } = await service.startOAuth("org-1", "TIKTOK");
    const url = new URL(authorizationUrl);

    expect(url.searchParams.get("client_key")).toBe("sbawkey123");
    expect(url.searchParams.get("scope")).toBe("user.info.stats");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/connectors/tiktok/callback",
    );
    expect(url.searchParams.get("state")).toBe(ISSUED_STATE);
    // Percent-encoded exactly as the developer panel registered it.
    expect(authorizationUrl).toContain(
      "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fconnectors%2Ftiktok%2Fcallback",
    );
  });

  it("never leaks the client secret into the browser-bound URL", async () => {
    const service = createMarketplaceService();
    const { authorizationUrl } = await service.startOAuth("org-1", "TIKTOK");
    expect(authorizationUrl).not.toContain("sbawsecret456");
    expect(authorizationUrl).not.toContain("client_secret");
  });

  it("returns the CSRF state for the action layer to plant as an HttpOnly cookie", async () => {
    const service = createMarketplaceService();
    const { stateCookie } = await service.startOAuth("org-1", "TIKTOK");

    expect(stateCookie).toEqual({
      name: TIKTOK_LOGIN_STATE_COOKIE,
      value: ISSUED_STATE,
      maxAge: TIKTOK_LOGIN_STATE_TTL_SECONDS,
    });
    // The callback double-submits this against the redirect's `state`.
    const { authorizationUrl } = await service.startOAuth("org-1", "TIKTOK");
    expect(new URL(authorizationUrl).searchParams.get("state")).toBe(stateCookie?.value);
  });
});
