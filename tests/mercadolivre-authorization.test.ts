import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR016.1 — Mercado Livre OAuth redirect URI + reauthentication contract.
 *
 * THE PRODUCTION BUG
 * ------------------
 * With valid keys and a valid `CONNECTOR_ENCRYPTION_KEY`, every sync still
 * answered "Não foi possível listar os anúncios do Mercado Livre". Three
 * distinct faults hid behind that one sentence:
 *
 *   1. the `redirect_uri` sent on the code exchange was re-derived from the
 *      environment and could diverge from the one Meli actually used, so the
 *      exchange failed and the tenant kept a stale (or no) token;
 *   2. the listing call ran even with an empty/absent access token, turning
 *      "never authorized" into an opaque provider error;
 *   3. 401/403 answers were reported as generic failures, so the panel kept
 *      offering "Sincronizar" instead of "Conectar Conta do Mercado Livre".
 *
 * These tests pin all three fixes.
 */

import {
  ConnectorReauthRequiredError,
  ProviderApiError,
  requiresReauthentication,
} from "@/modules/marketplace/core/errors";
import {
  MERCADOLIVRE_CALLBACK_PATH,
  MERCADOLIVRE_CONNECT_CTA,
  assertMercadoLivreAuthorization,
  buildMercadoLivreAuthorizationUrl,
  exchangeMercadoLivreCode,
  fetchMercadoLivreItems,
  hasMercadoLivreAuthorization,
  mercadoLivreRedirectUriCandidates,
  resolveMercadoLivreRedirectUri,
} from "@/modules/marketplace/mercadolivre/mercadolivre.service";

const RENDER_URL = "https://brobond-ai-commerce.onrender.com";
const CONFIG = {
  clientId: "1234567890",
  clientSecret: "super-secret",
  apiBaseUrl: "https://api.mercadolibre.com",
  authBaseUrl: "https://auth.mercadolivre.com.br",
};

/** A callback request as Render delivers it: wildcard bind + proxy headers. */
function callbackRequest(
  path = MERCADOLIVRE_CALLBACK_PATH,
  host = "brobond-ai-commerce.onrender.com",
) {
  return {
    url: `http://0.0.0.0:10000${path}?code=TG-abc&state=s`,
    headers: new Headers({ "x-forwarded-host": host, "x-forwarded-proto": "https" }),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.APP_URL;
  delete process.env.MERCADOLIVRE_REDIRECT_URI;
  process.env.NEXTAUTH_URL = ORIGINAL_ENV.NEXTAUTH_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------
// 1. Redirect URI resolution
// ------------------------------------------------------------------

describe("mercadoLivreRedirectUriCandidates() — the domain divergence fix", () => {
  it("uses APP_URL in preference to NEXTAUTH_URL", () => {
    expect(
      resolveMercadoLivreRedirectUri(undefined, {
        APP_URL: "https://app.brobond.ai",
        NEXTAUTH_URL: RENDER_URL,
      }),
    ).toBe("https://app.brobond.ai/api/mercadolivre/callback");
  });

  it("falls back to NEXTAUTH_URL when APP_URL is unset", () => {
    expect(resolveMercadoLivreRedirectUri(undefined, { NEXTAUTH_URL: RENDER_URL })).toBe(
      `${RENDER_URL}/api/mercadolivre/callback`,
    );
  });

  it("lets an explicit MERCADOLIVRE_REDIRECT_URI win over both", () => {
    expect(
      resolveMercadoLivreRedirectUri(undefined, {
        MERCADOLIVRE_REDIRECT_URI: "https://legacy.example.com/api/mercadolivre/callback",
        APP_URL: "https://app.brobond.ai",
        NEXTAUTH_URL: RENDER_URL,
      }),
    ).toBe("https://legacy.example.com/api/mercadolivre/callback");
  });

  it("strips trailing slashes instead of producing a doubled path", () => {
    expect(resolveMercadoLivreRedirectUri(undefined, { APP_URL: "https://app.brobond.ai/" })).toBe(
      "https://app.brobond.ai/api/mercadolivre/callback",
    );
    expect(
      resolveMercadoLivreRedirectUri(undefined, {
        MERCADOLIVRE_REDIRECT_URI: "https://app.brobond.ai/api/mercadolivre/callback/",
      }),
    ).toBe("https://app.brobond.ai/api/mercadolivre/callback");
  });

  it("never derives the URI from the wildcard address Render binds to", () => {
    const candidates = mercadoLivreRedirectUriCandidates(callbackRequest(), {});
    expect(candidates.every((candidate) => !candidate.includes("0.0.0.0"))).toBe(true);
    // The proxy's forwarded host is used instead of the bind address.
    expect(candidates[0]).toBe(`${RENDER_URL}/api/mercadolivre/callback`);
  });

  it("keeps the request's real path, so the /api/connectors alias round-trips", () => {
    const candidates = mercadoLivreRedirectUriCandidates(
      callbackRequest("/api/connectors/mercadolivre/callback"),
      { APP_URL: "https://app.brobond.ai" },
    );
    expect(candidates).toEqual([
      "https://app.brobond.ai/api/mercadolivre/callback",
      `${RENDER_URL}/api/connectors/mercadolivre/callback`,
      "http://localhost:3000/api/mercadolivre/callback",
    ]);
  });

  it("de-duplicates identical candidates", () => {
    const candidates = mercadoLivreRedirectUriCandidates(callbackRequest(), {
      APP_URL: RENDER_URL,
      NEXTAUTH_URL: RENDER_URL,
      MERCADOLIVRE_REDIRECT_URI: `${RENDER_URL}/api/mercadolivre/callback`,
    });
    expect(
      candidates.filter((uri) => uri === `${RENDER_URL}/api/mercadolivre/callback`),
    ).toHaveLength(1);
  });

  it("builds the authorization URL with the configured redirect URI", () => {
    process.env.APP_URL = "https://app.brobond.ai";
    const url = new URL(buildMercadoLivreAuthorizationUrl("state-123", CONFIG));
    expect(url.origin).toBe("https://auth.mercadolivre.com.br");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CONFIG.clientId);
    expect(url.searchParams.get("scope")).toBe("read offline_access");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.brobond.ai/api/mercadolivre/callback",
    );
  });

  it("normalizes copied client ids and requests no write scopes", () => {
    process.env.APP_URL = "https://app.brobond.ai";
    const url = new URL(
      buildMercadoLivreAuthorizationUrl("state-minimum-scope", {
        ...CONFIG,
        clientId: "  APP-CLIENT-ID///  ",
        authBaseUrl: "  HTTPS://AUTH.MERCADOLIVRE.COM.BR/  ",
      }),
    );

    expect(url.searchParams.get("client_id")).toBe("app-client-id");
    expect(url.searchParams.getAll("scope")).toEqual(["read offline_access"]);
    expect(url.searchParams.get("scope")).not.toMatch(/write/i);
  });
});

// ------------------------------------------------------------------
// 2. Code exchange
// ------------------------------------------------------------------

describe("exchangeMercadoLivreCode() — redirect_uri recovery", () => {
  const tokenPayload = {
    access_token: "APP_USR-access",
    refresh_token: "TG-refresh",
    expires_in: 21_600,
    user_id: 987,
  };

  it("sends the configured redirect URI and returns the token pair", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(tokenPayload));

    const tokens = await exchangeMercadoLivreCode("TG-code", CONFIG, {
      redirectUris: [`${RENDER_URL}/api/mercadolivre/callback`],
    });

    expect(tokens.accessToken).toBe("APP_USR-access");
    expect(tokens.refreshToken).toBe("TG-refresh");
    expect(tokens.userId).toBe("987");
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("TG-code");
    expect(body.get("redirect_uri")).toBe(`${RENDER_URL}/api/mercadolivre/callback`);
  });

  it("retries with the next candidate when Meli rejects the first redirect URI", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400))
      .mockResolvedValueOnce(jsonResponse(tokenPayload));

    const tokens = await exchangeMercadoLivreCode("TG-code", CONFIG, {
      redirectUris: [
        "https://stale.example.com/api/mercadolivre/callback",
        `${RENDER_URL}/api/mercadolivre/callback`,
      ],
    });

    expect(tokens.accessToken).toBe("APP_USR-access");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retried = new URLSearchParams(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(retried.get("redirect_uri")).toBe(`${RENDER_URL}/api/mercadolivre/callback`);
  });

  it("does not burn candidates on a provider outage (5xx)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ message: "internal error" }, 503));

    await expect(
      exchangeMercadoLivreCode("TG-code", CONFIG, {
        redirectUris: ["https://a.example.com/cb", "https://b.example.com/cb"],
      }),
    ).rejects.toBeInstanceOf(ProviderApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces an unrecoverable rejection as a reauthentication failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400));

    const error = await exchangeMercadoLivreCode("TG-code", CONFIG, {
      redirectUris: ["https://a.example.com/cb"],
    }).catch((caught: unknown) => caught);

    expect(requiresReauthentication(error)).toBe(true);
  });
});

// ------------------------------------------------------------------
// 3. Safe client initialization
// ------------------------------------------------------------------

describe("authorization guard — no token, no API call", () => {
  it("recognizes a usable credential pair", () => {
    expect(hasMercadoLivreAuthorization("APP_USR-token", "123")).toBe(true);
    expect(hasMercadoLivreAuthorization("APP_USR-token")).toBe(true);
    expect(hasMercadoLivreAuthorization("", "123")).toBe(false);
    expect(hasMercadoLivreAuthorization("   ", "123")).toBe(false);
    expect(hasMercadoLivreAuthorization(null, "123")).toBe(false);
    expect(hasMercadoLivreAuthorization("APP_USR-token", "")).toBe(false);
    expect(hasMercadoLivreAuthorization("APP_USR-token", null)).toBe(false);
  });

  it("asserts with the connect call to action in the message", () => {
    try {
      assertMercadoLivreAuthorization("", "123");
      expect.unreachable("the guard must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorReauthRequiredError);
      expect((error as Error).message).toContain(MERCADOLIVRE_CONNECT_CTA);
      expect(requiresReauthentication(error)).toBe(true);
    }
  });

  it("never calls the Meli API when the access token is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(fetchMercadoLivreItems("", "123456", 50, CONFIG)).rejects.toBeInstanceOf(
      ConnectorReauthRequiredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never calls the Meli API when the seller id was never resolved", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(fetchMercadoLivreItems("APP_USR-token", "", 50, CONFIG)).rejects.toBeInstanceOf(
      ConnectorReauthRequiredError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// 4. Robust provider error handling
// ------------------------------------------------------------------

describe("fetchMercadoLivreItems() — provider failures become instructions", () => {
  it("turns a 401 into a reauthentication instruction, not a listing error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ message: "invalid_token", status: 401 }, 401),
    );

    const error = await fetchMercadoLivreItems("APP_USR-stale", "123456", 50, CONFIG).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConnectorReauthRequiredError);
    expect((error as Error).message).toContain(MERCADOLIVRE_CONNECT_CTA);
    // The provider payload never reaches the operator verbatim.
    expect((error as Error).message).not.toContain("invalid_token");
    expect(requiresReauthentication(error)).toBe(true);
  });

  it("treats a 403 (token of another seller / missing scope) the same way", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ message: "forbidden" }, 403));

    const error = await fetchMercadoLivreItems("APP_USR-other", "123456", 50, CONFIG).catch(
      (caught: unknown) => caught,
    );

    expect(requiresReauthentication(error)).toBe(true);
    expect((error as Error).message).toContain(MERCADOLIVRE_CONNECT_CTA);
  });

  it("keeps a rate limit retryable — reconnecting would not help", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ message: "too many" }, 429));

    const error = await fetchMercadoLivreItems("APP_USR-token", "123456", 50, CONFIG).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderApiError);
    expect(requiresReauthentication(error)).toBe(false);
    expect((error as Error).message).toContain("rate limit");
  });

  it("keeps a provider outage retryable and reassures about the credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ message: "boom" }, 502));

    const error = await fetchMercadoLivreItems("APP_USR-token", "123456", 50, CONFIG).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderApiError);
    expect(requiresReauthentication(error)).toBe(false);
    expect((error as Error).message).toContain("instável");
  });

  it("reports a network failure without blaming the credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));

    const error = await fetchMercadoLivreItems("APP_USR-token", "123456", 50, CONFIG).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderApiError);
    expect((error as ProviderApiError).status).toBe(503);
    expect(requiresReauthentication(error)).toBe(false);
  });

  it("still returns normalized listings on the happy path", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ results: ["MLB123"] }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            code: 200,
            body: {
              id: "MLB123",
              title: "Camiseta Oversized",
              permalink: "https://produto.mercadolivre.com.br/MLB123",
              thumbnail: "https://http2.mlstatic.com/thumb.jpg",
              price: 189.9,
              currency_id: "BRL",
              sold_quantity: 12,
            },
          },
        ]),
      );

    const items = await fetchMercadoLivreItems("APP_USR-token", "123456", 50, CONFIG);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: "meli:item:123456:MLB123",
      type: "PRODUCT",
      title: "Camiseta Oversized",
      views: 12,
    });
  });

  it("returns an empty catalog (never an error) for a seller with no listings", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ results: [] }));
    await expect(fetchMercadoLivreItems("APP_USR-token", "123456", 50, CONFIG)).resolves.toEqual(
      [],
    );
  });
});
