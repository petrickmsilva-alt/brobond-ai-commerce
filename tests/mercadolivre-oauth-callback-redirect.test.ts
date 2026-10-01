import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_FALLBACK_BASE_URL, resolveRedirectBaseUrl } from "@/lib/app-url";

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

    const response = await GET(new Request(RENDER_REQUEST_URL));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://brobond-ai-commerce.onrender.com/dashboard/connectors/mercado-livre?oauth=connected",
    );
    expect(handleMercadoLivreCallback).toHaveBeenCalledWith({ code: "TG-abc", state: OAUTH_STATE });
  });

  it("uses the same absolute base for the error redirect", async () => {
    process.env.NEXTAUTH_URL = "https://brobond-ai-commerce.onrender.com";

    const response = await GET(
      new Request("http://0.0.0.0:10000/api/mercadolivre/callback?error=access_denied"),
    );

    expect(response.headers.get("location")).toBe(
      "https://brobond-ai-commerce.onrender.com/dashboard/connectors/mercado-livre?oauth=error",
    );
    expect(handleMercadoLivreCallback).not.toHaveBeenCalled();
  });

  it("redirects (never throws) when the token exchange fails", async () => {
    process.env.NEXTAUTH_URL = "https://brobond-ai-commerce.onrender.com";
    handleMercadoLivreCallback.mockRejectedValue(new Error("invalid_grant: secret leaked"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request(RENDER_REQUEST_URL));

    expect(response.headers.get("location")).toBe(
      "https://brobond-ai-commerce.onrender.com/dashboard/connectors/mercado-livre?oauth=error",
    );
    // The provider's message must never reach the browser — only the log.
    expect(response.headers.get("location")).not.toContain("invalid_grant");
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
