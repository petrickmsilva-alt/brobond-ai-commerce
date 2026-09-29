import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  INVITATION_TTL_DAYS,
  PASSWORD_RESET_TTL_MINUTES,
  TOKEN_BYTES,
  expiresInDays,
  expiresInMinutes,
  generateToken,
  hashToken,
  invitationExpiry,
  isExpired,
  minutesUntil,
  passwordResetExpiry,
  safeCompareHash,
} from "@/lib/tokens";

/**
 * PR010.2 §6/§7 — single-use token primitives.
 *
 * These back both the password-reset and the invitation flows, so the digest
 * and expiry contracts are tested directly rather than only through the
 * services.
 */

describe("generateToken()", () => {
  it("produces a URL-safe base64url string", () => {
    for (let i = 0; i < 25; i += 1) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("is unique across many draws (no PRNG reuse)", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
  });

  it("carries 32 bytes (256 bits) of entropy by default", () => {
    expect(TOKEN_BYTES).toBe(32);
    // base64url of 32 bytes is 43 characters, unpadded.
    expect(generateToken()).toHaveLength(43);
  });

  it("honours a custom byte length", () => {
    expect(generateToken(64).length).toBeGreaterThan(generateToken(16).length);
  });
});

describe("hashToken()", () => {
  it("returns the SHA-256 hex digest", () => {
    const raw = "a-known-token";
    const expected = createHash("sha256").update(raw, "utf8").digest("hex");
    expect(hashToken(raw)).toBe(expected);
  });

  it("is deterministic", () => {
    const raw = generateToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it("is 64 hex characters", () => {
    expect(hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("NEVER returns the raw token — the digest is all that is persisted", () => {
    const raw = generateToken();
    const digest = hashToken(raw);
    expect(digest).not.toBe(raw);
    expect(digest).not.toContain(raw);
  });

  it("changes completely for a one-character difference", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});

describe("safeCompareHash()", () => {
  it("is true for identical digests", () => {
    const digest = hashToken("same");
    expect(safeCompareHash(digest, digest)).toBe(true);
  });

  it("is false for different digests", () => {
    expect(safeCompareHash(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("is false for different lengths (and does not throw)", () => {
    expect(safeCompareHash("short", hashToken("long"))).toBe(false);
    expect(safeCompareHash("", hashToken("x"))).toBe(false);
  });
});

describe("expiry helpers", () => {
  const NOW = new Date("2026-09-23T12:00:00.000Z");

  it("§6: a password-reset token expires in exactly 30 minutes", () => {
    expect(PASSWORD_RESET_TTL_MINUTES).toBe(30);
    expect(passwordResetExpiry(NOW).toISOString()).toBe("2026-09-23T12:30:00.000Z");
  });

  it("an invitation expires in 7 days", () => {
    expect(INVITATION_TTL_DAYS).toBe(7);
    expect(invitationExpiry(NOW).toISOString()).toBe("2026-09-30T12:00:00.000Z");
  });

  it("expiresInMinutes()/expiresInDays() are exact", () => {
    expect(expiresInMinutes(15, NOW).toISOString()).toBe("2026-09-23T12:15:00.000Z");
    expect(expiresInDays(2, NOW).toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });

  it("does not mutate the `now` it is given", () => {
    const now = new Date(NOW);
    passwordResetExpiry(now);
    invitationExpiry(now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });
});

describe("isExpired()", () => {
  const NOW = new Date("2026-09-23T12:00:00.000Z");

  it("is false one minute before expiry", () => {
    expect(isExpired(new Date("2026-09-23T12:01:00.000Z"), NOW)).toBe(false);
  });

  it("is true one minute after expiry", () => {
    expect(isExpired(new Date("2026-09-23T11:59:00.000Z"), NOW)).toBe(true);
  });

  it("treats the exact boundary as EXPIRED (safe direction)", () => {
    expect(isExpired(new Date(NOW), NOW)).toBe(true);
  });

  it("treats a missing expiry as expired", () => {
    expect(isExpired(null, NOW)).toBe(true);
    expect(isExpired(undefined, NOW)).toBe(true);
  });

  it("a freshly issued reset token is valid, and stale at +31min", () => {
    const expiry = passwordResetExpiry(NOW);
    expect(isExpired(expiry, NOW)).toBe(false);
    expect(isExpired(expiry, new Date("2026-09-23T12:29:59.000Z"))).toBe(false);
    expect(isExpired(expiry, new Date("2026-09-23T12:30:01.000Z"))).toBe(true);
    expect(isExpired(expiry, new Date("2026-09-23T12:31:00.000Z"))).toBe(true);
  });
});

describe("minutesUntil()", () => {
  const NOW = new Date("2026-09-23T12:00:00.000Z");

  it("reports the remaining whole minutes", () => {
    expect(minutesUntil(new Date("2026-09-23T12:30:00.000Z"), NOW)).toBe(30);
  });

  it("rounds a partial minute up", () => {
    expect(minutesUntil(new Date("2026-09-23T12:00:30.000Z"), NOW)).toBe(1);
  });

  it("never goes negative", () => {
    expect(minutesUntil(new Date("2026-09-23T11:00:00.000Z"), NOW)).toBe(0);
    expect(minutesUntil(new Date(NOW), NOW)).toBe(0);
  });
});
