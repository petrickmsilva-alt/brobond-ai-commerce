import { describe, expect, it } from "vitest";
import { APP_URL_ENV_KEYS, buildInviteUrl, resolveAppBaseUrl } from "@/lib/app-url";

/**
 * PR010.3 §12 — APP_URL: the canonical public base URL.
 *
 * PR010.2 built invitation links from NEXTAUTH_URL, a variable that belongs
 * to NextAuth's callback machinery. PR010.3 introduces APP_URL for
 * human-facing links with NEXTAUTH_URL as the fallback, so existing
 * deployments keep working. These tests pin the resolution order, the
 * normalization and the guard against a malformed base.
 */

describe("resolveAppBaseUrl()", () => {
  it("prefers APP_URL over NEXTAUTH_URL", () => {
    expect(
      resolveAppBaseUrl({ APP_URL: "https://app.brobond.ai", NEXTAUTH_URL: "https://old.example" }),
    ).toBe("https://app.brobond.ai");
  });

  it("falls back to NEXTAUTH_URL when APP_URL is absent", () => {
    expect(resolveAppBaseUrl({ NEXTAUTH_URL: "https://auth.example" })).toBe(
      "https://auth.example",
    );
  });

  it("returns an empty string when nothing is configured", () => {
    expect(resolveAppBaseUrl({})).toBe("");
  });

  it("ignores a blank APP_URL and falls through to NEXTAUTH_URL", () => {
    expect(resolveAppBaseUrl({ APP_URL: "   ", NEXTAUTH_URL: "https://fallback.example" })).toBe(
      "https://fallback.example",
    );
  });

  it("strips trailing slashes (one, many, and mixed)", () => {
    expect(resolveAppBaseUrl({ APP_URL: "https://app.example/" })).toBe("https://app.example");
    expect(resolveAppBaseUrl({ APP_URL: "https://app.example//" })).toBe("https://app.example");
    expect(resolveAppBaseUrl({ APP_URL: "https://app.example/brobond///" })).toBe(
      "https://app.example/brobond",
    );
  });

  it("trims surrounding whitespace before validating", () => {
    expect(resolveAppBaseUrl({ APP_URL: "  https://app.example  " })).toBe("https://app.example");
  });

  it("accepts http:// origins (local development)", () => {
    expect(resolveAppBaseUrl({ APP_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
  });

  it("treats a non-http(s) APP_URL as absent", () => {
    expect(
      resolveAppBaseUrl({ APP_URL: "ftp://files.example", NEXTAUTH_URL: "https://ok.example" }),
    ).toBe("https://ok.example");
  });

  it("treats a scheme-less APP_URL as absent", () => {
    expect(resolveAppBaseUrl({ APP_URL: "app.example", NEXTAUTH_URL: "https://ok.example" })).toBe(
      "https://ok.example",
    );
  });

  it("treats an APP_URL that is only a protocol as absent", () => {
    expect(resolveAppBaseUrl({ APP_URL: "https://", NEXTAUTH_URL: "https://ok.example" })).toBe(
      "https://ok.example",
    );
  });

  it("never returns a base with a trailing slash", () => {
    for (const env of [
      { APP_URL: "https://a.example/" },
      { APP_URL: "https://b.example", NEXTAUTH_URL: "https://c.example/" },
      { NEXTAUTH_URL: "https://d.example//" },
    ]) {
      expect(resolveAppBaseUrl(env)).not.toMatch(/\/$/);
    }
  });

  it("documents the precedence order", () => {
    expect(APP_URL_ENV_KEYS).toEqual(["APP_URL", "NEXTAUTH_URL"]);
  });

  it("reads process.env by default (no injection required)", () => {
    // The default-parameter path: whatever the ambient environment is, the
    // result must be a string (never throw, never undefined).
    const value = resolveAppBaseUrl();
    expect(typeof value).toBe("string");
  });
});

describe("buildInviteUrl()", () => {
  it("joins a base and a token with exactly one slash", () => {
    expect(buildInviteUrl("https://app.example", "tok_abc")).toBe(
      "https://app.example/invite/tok_abc",
    );
  });

  it("tolerates a base with trailing slashes", () => {
    expect(buildInviteUrl("https://app.example///", "tok_abc")).toBe(
      "https://app.example/invite/tok_abc",
    );
  });

  it("produces a relative link when the base is empty", () => {
    expect(buildInviteUrl("", "tok_abc")).toBe("/invite/tok_abc");
  });

  it("produces a relative link when the base is not a string", () => {
    expect(buildInviteUrl(undefined as unknown as string, "tok_abc")).toBe("/invite/tok_abc");
  });

  it("keeps the raw token verbatim — the URL IS the delivery channel", () => {
    const token = "AbCdEfGh1234567890-_";
    expect(buildInviteUrl("https://app.example", token)).toContain(token);
  });

  it("never produces a protocol-relative URL", () => {
    for (const base of ["", "https://app.example"]) {
      expect(buildInviteUrl(base, "tok")).not.toContain("//invite");
    }
  });

  it("round-trips with resolveAppBaseUrl()", () => {
    const env = { APP_URL: "https://app.example/" };
    expect(buildInviteUrl(resolveAppBaseUrl(env), "tok_abc")).toBe(
      "https://app.example/invite/tok_abc",
    );
  });
});
