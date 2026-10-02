import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_FALLBACK_BASE_URL,
  listRedirectBaseUrls,
  resolveRedirectBaseUrl,
  resolveRequestUrl,
} from "@/lib/app-url";

/**
 * The Mercado Livre callback redirect (ERR_ADDRESS_INVALID regression).
 *
 * The token exchange worked in production and the callback still dropped the
 * seller on a dead page: the redirect was built from `request.url`, which on
 * Render is the wildcard address Next.js binds to (`0.0.0.0:10000`), so the
 * browser was sent to `http://0.0.0.0/dashboard/connectors?oauth=connected`.
 * These tests pin the rule that the public address comes from `APP_URL` /
 * `NEXTAUTH_URL`, and that no wildcard host can ever reach the browser.
 */

// The opaque one-time state must survive the validator (min. 16 chars).
const OAUTH_STATE = "b7f1c2d9e4a85630f1c2d9e4a8563012";
const RENDER_REQUEST_URL = `http://0.0.0.0:10000/api/mercadolivre/callback?code=TG-abc&state=${OAUTH_STATE}`;

function fakeRequest(url: string, headers: Record<string, string> = {}) {
  return { url, headers: new Headers(headers) };
}

describe("resolveRedirectBaseUrl()", () => {
  it("uses NEXTAUTH_URL instead of the wildcard address Render binds to", () => {
    expect(
      resolveRedirectBaseUrl(fakeRequest(RENDER_REQUEST_URL), {
        NEXTAUTH_URL: "https://brobond-ai-commerce.onrender.com",
      }),
    ).toBe("https://brobond-ai-commerce.onrender.com");
  });

  it("prefers APP_URL over NEXTAUTH_URL", () => {
    expect(
      resolveRedirectBaseUrl(fakeRequest(RENDER_REQUEST_URL), {
        APP_URL: "https://app.brobond.ai",
        NEXTAUTH_URL: "https://brobond-ai-commerce.onrender.com",
      }),
    ).toBe("https://app.brobond.ai");
  });

  it("strips a trailing slash so the path is never doubled", () => {
    expect(
      resolveRedirectBaseUrl(fakeRequest(RENDER_REQUEST_URL), {
        NEXTAUTH_URL: "https://app.brobond.ai/",
      }),
    ).toBe("https://app.brobond.ai");
  });

  it("keeps a configured sub-path deployment base", () => {
    expect(
      resolveRedirectBaseUrl(fakeRequest(RENDER_REQUEST_URL), {
        APP_URL: "https://example.com/brobond",
      }),
    ).toBe("https://example.com/brobond");
  });

  it("skips a misconfigured wildcard APP_URL and falls through to NEXTAUTH_URL", () => {
    expect(
      resolveRedirectBaseUrl(fakeRequest(RENDER_REQUEST_URL), {
        APP_URL: "http://0.0.0.0:10000",
        NEXTAUTH_URL: "https://brobond-ai-commerce.onrender.com",
      }),
    ).toBe("https://brobond-ai-commerce.onrender.com");
  });

  it("falls back to the proxy's forwarded host when nothing is configured", () => {
    expect(
      resolveRedirectBaseUrl(
        fakeRequest(RENDER_REQUEST_URL, {
          "x-forwarded-host": "brobond-ai-commerce.onrender.com",
          "x-forwarded-proto": "https",
        }),
        {},
      ),
    ).toBe("https://brobond-ai-commerce.onrender.com");
  });

  it("reads only the first entry of a forwarded header chain", () => {
    expect(
      resolveRedirectBaseUrl(
        fakeRequest(RENDER_REQUEST_URL, {
          "x-forwarded-host": "edge.example.com, internal.example.com",
          "x-forwarded-proto": "https, http",
        }),
        {},
      ),
    ).toBe("https://edge.example.com");
  });

  it("reduces a usable request URL to its origin (local development)", () => {
    expect(
      resolveRedirectBaseUrl(fakeRequest("http://localhost:3000/api/mercadolivre/callback"), {}),
    ).toBe("http://localhost:3000");
  });

  it("never returns an unroutable host, even with no env and no headers", () => {
    expect(resolveRedirectBaseUrl(fakeRequest(RENDER_REQUEST_URL), {})).toBe(
      LOCAL_FALLBACK_BASE_URL,
    );
    expect(resolveRedirectBaseUrl(fakeRequest("http://[::]:10000/api/x"), {})).toBe(
      LOCAL_FALLBACK_BASE_URL,
    );
  });
});

/**
 * PR016.1 — the OAuth code exchange needs EVERY candidate, not just the
 * winner: when the URI registered in the provider's console does not match
 * `APP_URL`, the next candidate is what rescues the connection.
 */
describe("listRedirectBaseUrls()", () => {
  it("lists the configured bases before the proxy host, in precedence order", () => {
    expect(
      listRedirectBaseUrls(
        fakeRequest(RENDER_REQUEST_URL, { "x-forwarded-host": "edge.example.com" }),
        { APP_URL: "https://app.brobond.ai", NEXTAUTH_URL: "https://brobond.onrender.com" },
      ),
    ).toEqual([
      "https://app.brobond.ai",
      "https://brobond.onrender.com",
      "https://edge.example.com",
    ]);
  });

  it("de-duplicates identical bases and drops unroutable ones", () => {
    expect(
      listRedirectBaseUrls(fakeRequest(RENDER_REQUEST_URL), {
        APP_URL: "https://app.brobond.ai",
        NEXTAUTH_URL: "https://app.brobond.ai/",
      }),
    ).toEqual(["https://app.brobond.ai"]);
  });

  it("is empty when nothing resolves to a navigable address", () => {
    expect(listRedirectBaseUrls(fakeRequest(RENDER_REQUEST_URL), {})).toEqual([]);
  });
});

describe("resolveRequestUrl()", () => {
  it("rebuilds the public URL of the callback from the proxy headers", () => {
    expect(
      resolveRequestUrl(
        fakeRequest(RENDER_REQUEST_URL, {
          "x-forwarded-host": "brobond-ai-commerce.onrender.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://brobond-ai-commerce.onrender.com/api/mercadolivre/callback");
  });

  it("drops the query string (code and state never belong in a redirect_uri)", () => {
    expect(
      resolveRequestUrl(
        fakeRequest("https://app.example.com/api/mercadolivre/callback?code=TG-abc&state=xyz"),
      ),
    ).toBe("https://app.example.com/api/mercadolivre/callback");
  });

  it("returns an empty string for the wildcard bind address with no proxy header", () => {
    expect(resolveRequestUrl(fakeRequest(RENDER_REQUEST_URL))).toBe("");
    expect(resolveRequestUrl(undefined)).toBe("");
  });
});

const handleMercadoLivreCallback = vi.hoisted(() => vi.fn());

vi.mock("@/modules/marketplace/core/connector.service", () => ({
  marketplaceService: { handleMercadoLivreCallback },
}));

const { GET } = await import("@/app/api/mercadolivre/callback/route");

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  handleMercadoLivreCallback.mockReset();
  process.env.NEXTAUTH_URL = ORIGINAL_ENV.NEXTAUTH_URL;
  delete process.env.APP_URL;
});

describe("GET /api/mercadolivre/callback", () => {
  it("redirects to the public dashboard URL after a successful exchange", async () => {
    process.env.NEXTAUTH_URL = "https://brobond-ai-commerce.onrender.com";
    handleMercadoLivreCallback.mockResolvedValue(undefined);

    const request = new Request(RENDER_REQUEST_URL);
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://brobond-ai-commerce.onrender.com/dashboard/connectors/mercado-livre?oauth=connected",
    );
    // PR016.1 — the request travels with the payload so the exchange can
    // replay the exact `redirect_uri` Meli just used.
    expect(handleMercadoLivreCallback).toHaveBeenCalledWith(
      { code: "TG-abc", state: OAUTH_STATE },
      { request },
    );
  });

  it("uses the same absolute base for the error redirect", async () => {
    process.env.NEXTAUTH_URL = "https://brobond-ai-commerce.onrender.com";
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await GET(
      new Request("http://0.0.0.0:10000/api/mercadolivre/callback?error=access_denied"),
    );

    expect(response.headers.get("location")).toBe(
      "https://brobond-ai-commerce.onrender.com/dashboard/connectors/mercado-livre?oauth=error&reason=denied",
    );
    expect(handleMercadoLivreCallback).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("redirects (never throws) when the token exchange fails", async () => {
    process.env.NEXTAUTH_URL = "https://brobond-ai-commerce.onrender.com";
    handleMercadoLivreCallback.mockRejectedValue(new Error("invalid_grant: secret leaked"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request(RENDER_REQUEST_URL));

    expect(response.headers.get("location")).toBe(
      "https://brobond-ai-commerce.onrender.com/dashboard/connectors/mercado-livre?oauth=error&reason=exchange",
    );
    // The provider's message must never reach the browser — only the log.
    expect(response.headers.get("location")).not.toContain("invalid_grant");
    expect(response.headers.get("location")).not.toContain("secret");
    consoleError.mockRestore();
  });

  it("classifies a replayed/expired state as `reason=state`, not a generic failure", async () => {
    process.env.NEXTAUTH_URL = "https://brobond-ai-commerce.onrender.com";
    const { ConnectorOAuthStateError } =
      await import("@/modules/marketplace/core/oauth-state.service");
    handleMercadoLivreCallback.mockRejectedValue(
      new ConnectorOAuthStateError("O estado de autorização já foi utilizado."),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request(RENDER_REQUEST_URL));

    expect(response.headers.get("location")).toBe(
      "https://brobond-ai-commerce.onrender.com/dashboard/connectors/mercado-livre?oauth=error&reason=state",
    );
    consoleError.mockRestore();
  });

  it("flags a missing client id/secret as `reason=config`", async () => {
    process.env.NEXTAUTH_URL = "https://brobond-ai-commerce.onrender.com";
    const { ConnectorConfigError } = await import("@/modules/marketplace/core/errors");
    handleMercadoLivreCallback.mockRejectedValue(
      new ConnectorConfigError("MERCADOLIVRE_CLIENT_SECRET", "MERCADOLIVRE"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request(RENDER_REQUEST_URL));

    expect(response.headers.get("location")).toBe(
      "https://brobond-ai-commerce.onrender.com/dashboard/connectors/mercado-livre?oauth=error&reason=config",
    );
    consoleError.mockRestore();
  });

  it("logs the redirect URIs it presented, so a DevCenter mismatch is diagnosable", async () => {
    process.env.NEXTAUTH_URL = "https://brobond-ai-commerce.onrender.com";
    handleMercadoLivreCallback.mockRejectedValue(new Error("invalid_grant"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await GET(new Request(RENDER_REQUEST_URL));

    expect(consoleError).toHaveBeenCalledWith(
      "[mercadolivre.oauth.callback]",
      expect.objectContaining({
        reason: "exchange",
        redirectUriCandidates: expect.arrayContaining([
          "https://brobond-ai-commerce.onrender.com/api/mercadolivre/callback",
        ]),
      }),
    );
    consoleError.mockRestore();
  });

  it("honours APP_URL over NEXTAUTH_URL for the browser-facing redirect", async () => {
    process.env.NEXTAUTH_URL = "https://brobond-ai-commerce.onrender.com";
    process.env.APP_URL = "https://app.brobond.ai";
    handleMercadoLivreCallback.mockResolvedValue(undefined);

    const response = await GET(new Request(RENDER_REQUEST_URL));

    expect(response.headers.get("location")).toBe(
      "https://app.brobond.ai/dashboard/connectors/mercado-livre?oauth=connected",
    );
  });
});
