import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR010.2 §2 — Edge middleware behaviour.
 *
 * `next-auth/jwt`'s `getToken` is mocked so these tests exercise the redirect
 * logic itself with no NextAuth, no Prisma, no database and no real cookie
 * crypto. The middleware's contract is:
 *
 *   protected + no session  → 307 to /login?next=<currentPath>
 *   protected + session     → pass through
 *   auth route + session    → 307 to the (sanitised) destination
 *   auth route + no session → pass through
 *   public/API/webhook      → pass through, never touched
 */

const getTokenMock = vi.hoisted(() => vi.fn());

vi.mock("next-auth/jwt", () => ({ getToken: getTokenMock }));

const { middleware, config } = await import("@/middleware");

/** Build the minimal NextRequest surface the middleware actually reads. */
function makeRequest(url: string, cookie?: string) {
  const parsed = new URL(url);
  return {
    url,
    nextUrl: parsed,
    headers: new Headers(cookie ? { cookie } : {}),
    cookies: { get: () => undefined },
  } as never;
}

function signedIn() {
  getTokenMock.mockResolvedValue({ sub: "user_1", role: "MEMBER", organizationId: "org_1" });
}

function signedOut() {
  getTokenMock.mockResolvedValue(null);
}

beforeEach(() => {
  getTokenMock.mockReset();
  process.env.AUTH_SECRET = "test-secret";
});

describe("protected routes without a session", () => {
  const PROTECTED = [
    "/dashboard",
    "/dashboard/products",
    "/products",
    "/creators",
    "/campaigns",
    "/analytics",
    "/outreach",
    "/ai",
    "/matches",
    "/connectors",
    "/settings",
  ];

  it.each(PROTECTED)("redirects %s to /login with the destination preserved", async (path) => {
    signedOut();
    const response = await middleware(makeRequest(`https://app.brobond.ai${path}`));

    expect(response.status).toBe(307);

    const location = new URL(response.headers.get("location") as string);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(path);
  });

  it("preserves the querystring of the original destination", async () => {
    signedOut();
    const response = await middleware(
      makeRequest("https://app.brobond.ai/dashboard/products?page=2&status=ACTIVE"),
    );

    const location = new URL(response.headers.get("location") as string);
    expect(location.searchParams.get("next")).toBe("/dashboard/products?page=2&status=ACTIVE");
  });

  it("redirects a deeply nested protected path", async () => {
    signedOut();
    const response = await middleware(
      makeRequest("https://app.brobond.ai/dashboard/products/abc123/edit"),
    );

    const location = new URL(response.headers.get("location") as string);
    expect(location.searchParams.get("next")).toBe("/dashboard/products/abc123/edit");
  });

  it("marks the redirect as uncacheable so a proxy cannot share it", async () => {
    signedOut();
    const response = await middleware(makeRequest("https://app.brobond.ai/dashboard"));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps the redirect on the same origin", async () => {
    signedOut();
    const response = await middleware(makeRequest("https://app.brobond.ai/dashboard"));
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin).toBe("https://app.brobond.ai");
  });
});

describe("protected routes with a session", () => {
  it.each(["/dashboard", "/products", "/settings", "/dashboard/analytics"])(
    "lets an authenticated user through to %s",
    async (path) => {
      signedIn();
      const response = await middleware(makeRequest(`https://app.brobond.ai${path}`));
      // NextResponse.next() carries no Location header.
      expect(response.headers.get("location")).toBeNull();
    },
  );
});

describe("auth routes", () => {
  it("sends an authenticated user from /login to /dashboard", async () => {
    signedIn();
    const response = await middleware(makeRequest("https://app.brobond.ai/login"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") as string).pathname).toBe("/dashboard");
  });

  it("honours a safe ?next= when bouncing an authenticated user off /login", async () => {
    signedIn();
    const response = await middleware(
      makeRequest("https://app.brobond.ai/login?next=%2Fdashboard%2Fproducts"),
    );

    const location = new URL(response.headers.get("location") as string);
    expect(location.pathname).toBe("/dashboard/products");
  });

  it("IGNORES a hostile ?next= and falls back to /dashboard", async () => {
    signedIn();
    const response = await middleware(
      makeRequest("https://app.brobond.ai/login?next=https%3A%2F%2Fevil.example"),
    );

    const location = new URL(response.headers.get("location") as string);
    expect(location.origin).toBe("https://app.brobond.ai");
    expect(location.pathname).toBe("/dashboard");
    expect(location.host).not.toContain("evil");
  });

  it("ignores a protocol-relative ?next=", async () => {
    signedIn();
    const response = await middleware(
      makeRequest("https://app.brobond.ai/login?next=%2F%2Fevil.example"),
    );

    const location = new URL(response.headers.get("location") as string);
    expect(location.origin).toBe("https://app.brobond.ai");
    expect(location.pathname).toBe("/dashboard");
  });

  it("lets an unauthenticated user see /login", async () => {
    signedOut();
    const response = await middleware(makeRequest("https://app.brobond.ai/login"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets an unauthenticated user see /forgot-password", async () => {
    signedOut();
    const response = await middleware(makeRequest("https://app.brobond.ai/forgot-password"));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("public routes are never gated", () => {
  const PUBLIC = [
    "/",
    "/request-access",
    "/invite/some-token",
    "/api/auth/signin",
    "/api/auth/callback/google",
    "/api/webhooks/tiktok",
    "/api/webhooks/whatsapp",
    "/api/webhooks/instagram",
    "/api/tiktok/callback",
    "/api/instagram/callback",
    "/api/whatsapp/callback",
  ];

  it.each(PUBLIC)("passes %s through without a session", async (path) => {
    signedOut();
    const response = await middleware(makeRequest(`https://app.brobond.ai${path}`));
    expect(response.headers.get("location")).toBeNull();
  });

  it("never even reads the token for a bypassed route", async () => {
    signedOut();
    getTokenMock.mockClear();
    await middleware(makeRequest("https://app.brobond.ai/api/webhooks/tiktok"));
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("does not redirect the landing page for a signed-out visitor", async () => {
    signedOut();
    const response = await middleware(makeRequest("https://app.brobond.ai/"));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("cookie selection", () => {
  it("uses the __Secure- prefixed cookie on https", async () => {
    signedIn();
    await middleware(makeRequest("https://app.brobond.ai/dashboard"));

    const args = getTokenMock.mock.calls[0]?.[0];
    expect(args.secureCookie).toBe(true);
    expect(args.cookieName).toBe("__Secure-authjs.session-token");
  });

  it("uses the unprefixed cookie on plain http (local dev)", async () => {
    delete process.env.NEXTAUTH_URL;
    signedIn();
    await middleware(makeRequest("http://localhost:3000/dashboard"));

    const args = getTokenMock.mock.calls[0]?.[0];
    expect(args.secureCookie).toBe(false);
    expect(args.cookieName).toBe("authjs.session-token");
  });

  it("passes AUTH_SECRET so the JWT can actually be decrypted", async () => {
    signedIn();
    await middleware(makeRequest("https://app.brobond.ai/dashboard"));
    expect(getTokenMock.mock.calls[0]?.[0].secret).toBe("test-secret");
  });
});

describe("matcher config", () => {
  it("exports a matcher", () => {
    expect(Array.isArray(config.matcher)).toBe(true);
    expect(config.matcher.length).toBeGreaterThan(0);
  });

  it("excludes Next.js internals and static assets", () => {
    const pattern = config.matcher[0] as string;
    expect(pattern).toContain("_next/static");
    expect(pattern).toContain("favicon.ico");
  });
});

// ------------------------------------------------------------------
// PR010.3 — new routes in the perimeter
// ------------------------------------------------------------------

describe("PR010.3 routes", () => {
  it("protects /dashboard/settings/access and preserves the destination", async () => {
    signedOut();
    const response = await middleware(
      makeRequest("https://app.brobond.ai/dashboard/settings/access"),
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") as string);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard/settings/access");
  });

  it("lets an authenticated user through to /dashboard/settings/access", async () => {
    signedIn();
    const response = await middleware(
      makeRequest("https://app.brobond.ai/dashboard/settings/access"),
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("never reads the token for /request-access/success", async () => {
    signedOut();
    getTokenMock.mockClear();
    const response = await middleware(makeRequest("https://app.brobond.ai/request-access/success"));

    expect(response.headers.get("location")).toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it.each(["/invite/invalid", "/invite/expired"])(
    "never reads the token for the invite error page %s",
    async (path) => {
      signedOut();
      getTokenMock.mockClear();
      const response = await middleware(makeRequest(`https://app.brobond.ai${path}`));

      expect(response.headers.get("location")).toBeNull();
      expect(getTokenMock).not.toHaveBeenCalled();
    },
  );

  it("passes an authenticated visitor through to the request-access success page", async () => {
    // Public by design: the page renders the same confirmation for everyone
    // and holds no data, so even a signed-in visitor may land on it.
    signedIn();
    const response = await middleware(makeRequest("https://app.brobond.ai/request-access/success"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("APP_URL (when https) selects the __Secure- cookie", async () => {
    process.env.APP_URL = "https://app.brobond.ai";
    delete process.env.NEXTAUTH_URL;
    signedIn();
    await middleware(makeRequest("http://internal-host:3000/dashboard"));

    const args = getTokenMock.mock.calls[0]?.[0];
    expect(args.secureCookie).toBe(true);
    delete process.env.APP_URL;
  });
});
