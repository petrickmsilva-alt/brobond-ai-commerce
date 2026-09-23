import { describe, expect, it } from "vitest";
import {
  AUTH_ROUTES,
  DEFAULT_AUTHENTICATED_REDIRECT,
  LOGIN_ROUTE,
  NEXT_PARAM,
  PROTECTED_ROUTES,
  PUBLIC_PREFIXES,
  buildLoginUrl,
  isAuthRoute,
  isProtectedRoute,
  isPublicRoute,
  matchesPrefix,
  resolveNext,
  sanitizeNext,
} from "@/lib/auth-routes";

/**
 * PR010.2 §2 — protected-route map and safe-redirect primitives.
 *
 * `sanitizeNext()` is the open-redirect gate for the whole application, so it
 * gets an adversarial test suite rather than a couple of happy paths.
 */

describe("PROTECTED_ROUTES — the §2 contract", () => {
  // The literal list from the PR010.2 brief.
  const CONTRACT = [
    "/dashboard",
    "/products",
    "/creators",
    "/campaigns",
    "/analytics",
    "/outreach",
    "/ai",
    "/matches",
    "/connectors",
  ];

  it("protects every route named in the contract", () => {
    for (const route of CONTRACT) {
      expect(PROTECTED_ROUTES).toContain(route);
    }
  });

  it("also protects /settings, which requires a session server-side", () => {
    expect(PROTECTED_ROUTES).toContain("/settings");
  });

  it("has no duplicate entries", () => {
    expect(new Set(PROTECTED_ROUTES).size).toBe(PROTECTED_ROUTES.length);
  });

  it("lists only absolute paths without trailing slashes", () => {
    for (const route of PROTECTED_ROUTES) {
      expect(route.startsWith("/")).toBe(true);
      expect(route.endsWith("/")).toBe(false);
    }
  });
});

describe("matchesPrefix()", () => {
  it("matches the prefix exactly", () => {
    expect(matchesPrefix("/dashboard", "/dashboard")).toBe(true);
  });

  it("matches nested paths", () => {
    expect(matchesPrefix("/dashboard/products/123/edit", "/dashboard")).toBe(true);
  });

  it("does NOT match a sibling sharing a string prefix", () => {
    // The classic bug: "/dashboardx" must not be treated as "/dashboard".
    expect(matchesPrefix("/dashboardx", "/dashboard")).toBe(false);
    expect(matchesPrefix("/products-archive", "/products")).toBe(false);
  });

  it("rejects non-absolute paths", () => {
    expect(matchesPrefix("dashboard", "/dashboard")).toBe(false);
  });
});

describe("isProtectedRoute()", () => {
  it.each([
    "/dashboard",
    "/dashboard/products",
    "/dashboard/analytics?range=30d",
    "/products",
    "/products/abc",
    "/creators",
    "/campaigns",
    "/analytics",
    "/outreach",
    "/ai",
    "/matches",
    "/connectors",
    "/settings",
  ])("protects %s", (path) => {
    expect(isProtectedRoute(path.split("?")[0] as string)).toBe(true);
  });

  it.each(["/", "/login", "/request-access", "/forgot-password", "/invite/abc", "/about"])(
    "does not protect %s",
    (path) => {
      expect(isProtectedRoute(path)).toBe(false);
    },
  );

  it("does not protect a sibling of a protected prefix", () => {
    expect(isProtectedRoute("/ai-studio")).toBe(false);
    expect(isProtectedRoute("/matches-export")).toBe(false);
  });
});

describe("isAuthRoute() / isPublicRoute()", () => {
  it("treats the auth screens as auth routes", () => {
    for (const route of AUTH_ROUTES) {
      expect(isAuthRoute(route)).toBe(true);
    }
  });

  it("never marks a protected route as an auth route", () => {
    for (const route of PROTECTED_ROUTES) {
      expect(isAuthRoute(route)).toBe(false);
    }
  });

  it("bypasses the NextAuth endpoints — they create the session", () => {
    expect(isPublicRoute("/api/auth/signin")).toBe(true);
    expect(isPublicRoute("/api/auth/callback/google")).toBe(true);
  });

  it("bypasses webhooks and OAuth callbacks (no session cookie by design)", () => {
    expect(isPublicRoute("/api/webhooks/tiktok")).toBe(true);
    expect(isPublicRoute("/api/webhooks/whatsapp")).toBe(true);
    expect(isPublicRoute("/api/tiktok/callback")).toBe(true);
    expect(isPublicRoute("/api/instagram/callback")).toBe(true);
  });

  it("bypasses the public auth entry points", () => {
    expect(isPublicRoute("/invite/sometoken")).toBe(true);
    expect(isPublicRoute("/request-access")).toBe(true);
  });

  it("does not bypass a protected route", () => {
    for (const route of PROTECTED_ROUTES) {
      expect(isPublicRoute(route)).toBe(false);
    }
  });

  it("exposes the expected public prefixes", () => {
    expect(PUBLIC_PREFIXES).toContain("/api/auth");
    expect(PUBLIC_PREFIXES).toContain("/_next");
  });
});

describe("sanitizeNext() — open-redirect defence", () => {
  it("accepts a same-origin absolute path", () => {
    expect(sanitizeNext("/dashboard")).toBe("/dashboard");
    expect(sanitizeNext("/dashboard/products")).toBe("/dashboard/products");
  });

  it("preserves the querystring and hash of a safe path", () => {
    expect(sanitizeNext("/dashboard/products?page=2&status=ACTIVE")).toBe(
      "/dashboard/products?page=2&status=ACTIVE",
    );
    expect(sanitizeNext("/dashboard#kpis")).toBe("/dashboard#kpis");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeNext("  /dashboard  ")).toBe("/dashboard");
  });

  // --- The attacks -------------------------------------------------

  it("rejects absolute URLs to another origin", () => {
    expect(sanitizeNext("https://evil.example")).toBeNull();
    expect(sanitizeNext("http://evil.example/path")).toBeNull();
    expect(sanitizeNext("HTTPS://EVIL.EXAMPLE")).toBeNull();
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizeNext("//evil.example")).toBeNull();
    expect(sanitizeNext("//evil.example/path")).toBeNull();
  });

  it("rejects backslash variants that browsers normalise to //", () => {
    expect(sanitizeNext("/\\evil.example")).toBeNull();
    expect(sanitizeNext("\\\\evil.example")).toBeNull();
    expect(sanitizeNext("/path\\to")).toBeNull();
  });

  it("rejects non-http schemes", () => {
    expect(sanitizeNext("javascript:alert(1)")).toBeNull();
    expect(sanitizeNext("data:text/html,<script>")).toBeNull();
    expect(sanitizeNext("file:///etc/passwd")).toBeNull();
  });

  it("rejects an embedded scheme after the leading slash", () => {
    expect(sanitizeNext("/javascript:alert(1)")).toBeNull();
  });

  it("rejects control characters and encoded newlines", () => {
    expect(sanitizeNext("/dashboard\nSet-Cookie: x=1")).toBeNull();
    expect(sanitizeNext("/dashboard\r\n")).toBeNull();
    expect(sanitizeNext("/dashboard%0aSet-Cookie")).toBeNull();
    expect(sanitizeNext("/dashboard%0D")).toBeNull();
    expect(sanitizeNext("/dash\tboard")).toBeNull();
  });

  it("rejects relative paths", () => {
    expect(sanitizeNext("dashboard")).toBeNull();
    expect(sanitizeNext("../dashboard")).toBeNull();
  });

  it("rejects auth routes to avoid a redirect loop", () => {
    expect(sanitizeNext("/login")).toBeNull();
    expect(sanitizeNext("/login?next=/dashboard")).toBeNull();
    expect(sanitizeNext("/forgot-password")).toBeNull();
    expect(sanitizeNext("/reset-password?token=abc")).toBeNull();
  });

  it("rejects empty and non-string values", () => {
    expect(sanitizeNext("")).toBeNull();
    expect(sanitizeNext("   ")).toBeNull();
    expect(sanitizeNext(null)).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
    expect(sanitizeNext(42 as unknown as string)).toBeNull();
    expect(sanitizeNext({} as unknown as string)).toBeNull();
  });
});

describe("resolveNext()", () => {
  it("returns the sanitised path when it is safe", () => {
    expect(resolveNext("/dashboard/products")).toBe("/dashboard/products");
  });

  it("falls back to /dashboard for every unsafe value", () => {
    for (const hostile of [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
      "/login",
      "",
      null,
      undefined,
    ]) {
      expect(resolveNext(hostile)).toBe(DEFAULT_AUTHENTICATED_REDIRECT);
    }
  });

  it("never returns a value that fails sanitizeNext()", () => {
    const samples = ["/dashboard", "https://evil.example", "/products?x=1", "//evil", null];
    for (const sample of samples) {
      const resolved = resolveNext(sample);
      expect(resolved === DEFAULT_AUTHENTICATED_REDIRECT || sanitizeNext(resolved)).toBeTruthy();
    }
  });
});

describe("buildLoginUrl() — the §1 Dashboard CTA", () => {
  it("produces /login?next=/dashboard for the dashboard destination", () => {
    // This exact string is the §1 contract for the landing page CTA.
    expect(buildLoginUrl("/dashboard")).toBe("/login?next=%2Fdashboard");
  });

  it("encodes the destination so query/hash survive intact", () => {
    expect(buildLoginUrl("/dashboard/products?page=2")).toBe(
      "/login?next=%2Fdashboard%2Fproducts%3Fpage%3D2",
    );
  });

  it("returns a bare /login when the destination is missing or unsafe", () => {
    expect(buildLoginUrl(null)).toBe(LOGIN_ROUTE);
    expect(buildLoginUrl(undefined)).toBe(LOGIN_ROUTE);
    expect(buildLoginUrl("")).toBe(LOGIN_ROUTE);
    expect(buildLoginUrl("https://evil.example")).toBe(LOGIN_ROUTE);
    expect(buildLoginUrl("//evil.example")).toBe(LOGIN_ROUTE);
  });

  it("never emits an off-origin destination", () => {
    const url = buildLoginUrl("https://evil.example");
    expect(url).not.toContain("evil.example");
  });

  it("round-trips through decodeURIComponent back to the safe path", () => {
    const url = buildLoginUrl("/dashboard/analytics?range=30d");
    const encoded = url.split(`${NEXT_PARAM}=`)[1] as string;
    expect(decodeURIComponent(encoded)).toBe("/dashboard/analytics?range=30d");
  });
});
