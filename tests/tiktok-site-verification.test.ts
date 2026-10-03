import { describe, expect, it } from "vitest";
import { GET, HEAD } from "@/app/tiktok-developers-site-verification/route";
import { PUBLIC_PREFIXES, isPublicRoute, isProtectedRoute } from "@/lib/auth-routes";

/**
 * Contract tests for the TikTok domain-ownership endpoint.
 *
 * This route is validated by a third party we cannot re-run on demand: if the
 * body gains a trailing newline or the content type drifts to `text/html`,
 * TikTok rejects the domain and the only signal is a failed review days later.
 * These assertions are deliberately byte-exact.
 */

const EXPECTED_TOKEN = "tiktok-developers-site-verification=2curKlcJu06uY8EYHsELz6YWP3VFqLLZ";

describe("GET /tiktok-developers-site-verification", () => {
  it("returns 200", () => {
    expect(GET().status).toBe(200);
  });

  it("returns the verification token byte for byte", async () => {
    const body = await GET().text();
    expect(body).toBe(EXPECTED_TOKEN);
  });

  it("has no leading/trailing whitespace, newline or BOM", async () => {
    const body = await GET().text();
    expect(body).toBe(body.trim());
    expect(body).not.toMatch(/[\r\n]/);
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("contains no HTML", async () => {
    const body = await GET().text();
    expect(body).not.toMatch(/[<>]/);
  });

  it("declares text/plain; charset=utf-8 explicitly", () => {
    expect(GET().headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("forbids content-type sniffing", () => {
    expect(GET().headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers HEAD with the same status and content type", () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });
});

describe("middleware posture for the verification route", () => {
  it("bypasses the auth proxy — TikTok's crawler carries no session cookie", () => {
    expect(isPublicRoute("/tiktok-developers-site-verification")).toBe(true);
    expect(PUBLIC_PREFIXES).toContain("/tiktok-developers-site-verification");
  });

  it("is never treated as a protected route", () => {
    expect(isProtectedRoute("/tiktok-developers-site-verification")).toBe(false);
  });
});
