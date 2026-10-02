import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR016.1/PR016.2 — Mercado Livre OAuth redirect URI + reauthentication
 * contract.
 *
 * THE PRODUCTION BUG
 * ------------------
 * With valid keys and a valid `CONNECTOR_ENCRYPTION_KEY`, every sync still
 * answered "Não foi possível listar os anúncios do Mercado Livre". Three
 * distinct faults hid behind that one sentence:
 *
 *   1. the `redirect_uri` sent on the code exchange was re-derived at
 *      callback time (including from the request's own headers) and could
 *      diverge from the one Meli actually used, so the exchange failed and
 *      the tenant kept a stale (or no) token. PR016.2 pins the value
 *      STATICALLY: `MERCADOLIVRE_REDIRECT_URI` / `MERCADOPAGO_REDIRECT_URI`
 *      (the unified ecosystem callback) — no request-derived computation;
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
  MERCADOLIVRE_CONNECT_CTA,
  assertMercadoLivreAuthorization,
  buildMercadoLivreAuthorizationUrl,
  exchangeMercadoLivreCode,
  fetchMercadoLivreItems,
  hasMercadoLivreAuthorization,
  mercadoLivreRedirectUriCandidates,
  resolveMercadoLivreNotificationOrderId,
  resolveMercadoLivreRedirectUri,
} from "@/modules/marketplace/mercadolivre/mercadolivre.service";

const RENDER_URL = "https://brobond-ai-commerce.onrender.com";
const CONFIG = {
  clientId: "1234567890",
  clientSecret: "super-secret",
  apiBaseUrl: "https://api.mercadolibre.com",
  authBaseUrl: "https://auth.mercadolivre.com.br",
};

/** The canonical token-set answer of a successful code exchange. */
function tokenPairPayload() {
  return {
    access_token: "APP_USR-access",
    refresh_token: "TG-refresh",
    expires_in: 21_600,
    user_id: 987,
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
  delete process.env.MERCADOPAGO_REDIRECT_URI;
  process.env.NEXTAUTH_URL = ORIGINAL_ENV.NEXTAUTH_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------
// 1. Redirect URI resolution — STATIC, environment-only (PR016.2)
// ------------------------------------------------------------------

describe("mercadoLivreRedirectUriCandidates() — the static unified redirect URI", () => {
  it("uses APP_URL in preference to NEXTAUTH_URL", () => {
    expect(
      resolveMercadoLivreRedirectUri({
        APP_URL: "https://app.brobond.ai",
        NEXTAUTH_URL: RENDER_URL,
      }),
    ).toBe("https://app.brobond.ai/api/mercadolivre/callback");
  });

  it("falls back to NEXTAUTH_URL when APP_URL is unset", () => {
    expect(resolveMercadoLivreRedirectUri({ NEXTAUTH_URL: RENDER_URL })).toBe(
      `${RENDER_URL}/api/mercadolivre/callback`,
    );
  });

  it("lets an explicit MERCADOLIVRE_REDIRECT_URI win over both", () => {
    expect(
      resolveMercadoLivreRedirectUri({
        MERCADOLIVRE_REDIRECT_URI: "https://legacy.example.com/api/mercadolivre/callback",
        APP_URL: "https://app.brobond.ai",
        NEXTAUTH_URL: RENDER_URL,
      }),
    ).toBe("https://legacy.example.com/api/mercadolivre/callback");
  });

  it("accepts MERCADOPAGO_REDIRECT_URI as the unified ecosystem alias", () => {
    // The director pinned the unified callback under the Mercado Pago name
    // on Render — the connector configuration service accepts EITHER name
    // and both point at the same handler.
    expect(
      resolveMercadoLivreRedirectUri({
        MERCADOPAGO_REDIRECT_URI: "https://app.example.com/api/mercadolivre/callback",
        APP_URL: "https://app.brobond.ai",
        NEXTAUTH_URL: RENDER_URL,
      }),
    ).toBe("https://app.example.com/api/mercadolivre/callback");
  });

  it("prefers MERCADOLIVRE_REDIRECT_URI when both ecosystem variables are set", () => {
    expect(
      resolveMercadoLivreRedirectUri({
        MERCADOLIVRE_REDIRECT_URI: "https://meli.example.com/api/mercadolivre/callback",
        MERCADOPAGO_REDIRECT_URI: "https://mp.example.com/api/mercadolivre/callback",
      }),
    ).toBe("https://meli.example.com/api/mercadolivre/callback");
  });

  it("strips trailing slashes instead of producing a doubled path", () => {
    expect(resolveMercadoLivreRedirectUri({ APP_URL: "https://app.brobond.ai/" })).toBe(
      "https://app.brobond.ai/api/mercadolivre/callback",
    );
    expect(
      resolveMercadoLivreRedirectUri({
        MERCADOPAGO_REDIRECT_URI: "https://app.brobond.ai/api/mercadolivre/callback/",
      }),
    ).toBe("https://app.brobond.ai/api/mercadolivre/callback");
  });

  it("resolves every candidate statically — never from a request", () => {
    // There is no request parameter to pass anymore (the compiler enforces
    // it); what still must hold is that a wildcard/unroutable bind address
    // can never leak into a candidate, even with nothing configured.
    const candidates = mercadoLivreRedirectUriCandidates({});
    expect(candidates.every((candidate) => !candidate.includes("0.0.0.0"))).toBe(true);
    expect(candidates).toEqual(["http://localhost:3000/api/mercadolivre/callback"]);
  });

  it("de-duplicates identical candidates", () => {
    const candidates = mercadoLivreRedirectUriCandidates({
      APP_URL: RENDER_URL,
      NEXTAUTH_URL: RENDER_URL,
      MERCADOPAGO_REDIRECT_URI: `${RENDER_URL}/api/mercadolivre/callback`,
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
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.brobond.ai/api/mercadolivre/callback",
    );
  });

  it("sends the SAME static redirect URI on the authorization URL and the exchange", async () => {
    process.env.MERCADOPAGO_REDIRECT_URI = "https://app.example.com/api/mercadolivre/callback";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(tokenPairPayload()));

    await exchangeMercadoLivreCode("TG-code", CONFIG);

    const authorizationUrl = new URL(buildMercadoLivreAuthorizationUrl("state-123", CONFIG));
    const exchangeBody = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/mercadolivre/callback",
    );
    expect(exchangeBody.get("redirect_uri")).toBe(
      "https://app.example.com/api/mercadolivre/callback",
    );
  });

  it("normalizes copied client ids and sends no public-app scope parameter", () => {
    process.env.APP_URL = "https://app.brobond.ai";
    const url = new URL(
      buildMercadoLivreAuthorizationUrl("state-minimum-scope", {
        ...CONFIG,
        clientId: "  APP-CLIENT-ID///  ",
        authBaseUrl: "  HTTPS://AUTH.MERCADOLIVRE.COM.BR/  ",
      }),
    );

    expect(url.searchParams.get("client_id")).toBe("app-client-id");
    expect(url.searchParams.has("scope")).toBe(false);
    expect([...url.searchParams.keys()].sort()).toEqual(
      ["client_id", "redirect_uri", "response_type", "state"].sort(),
    );
  });
});

// ------------------------------------------------------------------
// 2. Code exchange — the STATIC redirect URI is replayed verbatim
// ------------------------------------------------------------------

describe("exchangeMercadoLivreCode() — static redirect_uri replay", () => {
  const tokenPayload = tokenPairPayload();

  it("sends the resolved static redirect URI and returns the token pair", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(tokenPayload));

    const tokens = await exchangeMercadoLivreCode("TG-code", CONFIG, {
      redirectUri: `${RENDER_URL}/api/mercadolivre/callback`,
    });

    expect(tokens.accessToken).toBe("APP_USR-access");
    expect(tokens.refreshToken).toBe("TG-refresh");
    expect(tokens.userId).toBe("987");
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("TG-code");
    expect(body.get("redirect_uri")).toBe(`${RENDER_URL}/api/mercadolivre/callback`);
  });

  it("reads the unified MERCADOPAGO_REDIRECT_URI when no explicit override is given", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(tokenPairPayload()));
    process.env.MERCADOPAGO_REDIRECT_URI = "https://app.example.com/api/mercadolivre/callback";

    await exchangeMercadoLivreCode("TG-code", CONFIG);

    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.get("redirect_uri")).toBe("https://app.example.com/api/mercadolivre/callback");
  });

  it("never retries with another candidate — the static value is the contract", async () => {
    // PR016.2 removed the request-derived candidate probing: one grant, one
    // redirect_uri, one attempt. A rejection is surfaced immediately with
    // the URI that was presented (the one to register in DevCenter).
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(exchangeMercadoLivreCode("TG-code", CONFIG)).rejects.toBeInstanceOf(
      ProviderApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry on a provider outage (5xx)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ message: "internal error" }, 503));

    await expect(
      exchangeMercadoLivreCode("TG-code", CONFIG, {
        redirectUri: "https://a.example.com/cb",
      }),
    ).rejects.toBeInstanceOf(ProviderApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs the exact raw token body (and the redirect URI) when Meli rejects the exchange", async () => {
    const rawBody = '{"error":"invalid_scope","message":"application requires approval"}';
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(rawBody, {
        status: 400,
        statusText: "Bad Request",
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      exchangeMercadoLivreCode("TG-code", CONFIG, {
        redirectUri: "https://app.example.com/api/mercadolivre/callback",
      }),
    ).rejects.toBeInstanceOf(ProviderApiError);

    expect(consoleError).toHaveBeenCalledWith(
      "[mercadolivre.oauth.token] resposta rejeitada pelo Mercado Livre",
      expect.objectContaining({
        status: 400,
        statusText: "Bad Request",
        contentType: "application/json",
        redirectUri: "https://app.example.com/api/mercadolivre/callback",
        rawBody,
      }),
    );
  });

  it("surfaces an unrecoverable rejection as a reauthentication failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400));

    const error = await exchangeMercadoLivreCode("TG-code", CONFIG, {
      redirectUri: "https://a.example.com/cb",
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

describe("Mercado Livre webhook resource resolution", () => {
  it.each([
    ["payments", "/payments/987", { order: { id: 123456789 } }, "/payments/987"],
    ["payments", "/collections/988", { order_id: "123456789" }, "/collections/988"],
    ["shipments", "/shipments/654", { order_id: "123456789" }, "/shipments/654"],
  ])("resolves %s resources to the canonical order", async (topic, resource, payload, path) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload));

    await expect(
      resolveMercadoLivreNotificationOrderId("APP_USR-token", topic, resource, CONFIG),
    ).resolves.toBe("123456789");
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(path);
  });

  it("uses the order id directly and ignores item events", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      resolveMercadoLivreNotificationOrderId(
        "APP_USR-token",
        "orders_v2",
        "/orders/123456789",
        CONFIG,
      ),
    ).resolves.toBe("123456789");
    await expect(
      resolveMercadoLivreNotificationOrderId("APP_USR-token", "items", "/items/MLB123", CONFIG),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
