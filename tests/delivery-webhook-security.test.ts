import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  META_SIGNATURE_HEADER,
  computeMetaWebhookSignature,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from "@/modules/delivery/core/webhook-security";

const SECRET = "meta-app-secret-for-tests";
const BODY = JSON.stringify({ object: "instagram", entry: [] });

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("Meta X-Hub-Signature-256 verification", () => {
  it("exposes the official header name", () => {
    expect(META_SIGNATURE_HEADER).toBe("x-hub-signature-256");
  });

  it("accepts a validly signed payload", () => {
    expect(
      verifyMetaWebhookSignature({ rawBody: BODY, signature: sign(BODY), appSecret: SECRET }),
    ).toBe(true);
  });

  it("computeMetaWebhookSignature produces the sha256=<hex> envelope", () => {
    expect(computeMetaWebhookSignature(BODY, SECRET)).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("rejects a signature computed with another secret", () => {
    expect(
      verifyMetaWebhookSignature({
        rawBody: BODY,
        signature: sign(BODY, "other-secret"),
        appSecret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a signature for a different body", () => {
    expect(
      verifyMetaWebhookSignature({
        rawBody: `${BODY} `,
        signature: sign(BODY),
        appSecret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects when the header is missing or empty", () => {
    expect(verifyMetaWebhookSignature({ rawBody: BODY, signature: null, appSecret: SECRET })).toBe(
      false,
    );
    expect(
      verifyMetaWebhookSignature({ rawBody: BODY, signature: undefined, appSecret: SECRET }),
    ).toBe(false);
    expect(verifyMetaWebhookSignature({ rawBody: BODY, signature: "", appSecret: SECRET })).toBe(
      false,
    );
  });

  it("rejects wrong signature schemes", () => {
    const hex = sign(BODY).slice("sha256=".length);
    for (const bad of [`sha1=${hex}`, hex, `sha256:${hex}`, `SHA-256=${hex}`]) {
      expect(verifyMetaWebhookSignature({ rawBody: BODY, signature: bad, appSecret: SECRET })).toBe(
        false,
      );
    }
  });

  it("rejects malformed hex payloads", () => {
    expect(
      verifyMetaWebhookSignature({ rawBody: BODY, signature: "sha256=zzz", appSecret: SECRET }),
    ).toBe(false);
    expect(
      verifyMetaWebhookSignature({
        rawBody: BODY,
        signature: `sha256=${"a".repeat(63)}`,
        appSecret: SECRET,
      }),
    ).toBe(false);
    expect(
      verifyMetaWebhookSignature({
        rawBody: BODY,
        signature: `sha256=${"a".repeat(65)}`,
        appSecret: SECRET,
      }),
    ).toBe(false);
  });

  it("accepts upper-case hex by normalizing", () => {
    const upper = sign(BODY).toUpperCase().replace("SHA256=", "sha256=");
    expect(verifyMetaWebhookSignature({ rawBody: BODY, signature: upper, appSecret: SECRET })).toBe(
      true,
    );
  });

  it("accepts Buffer raw bodies exactly like strings", () => {
    expect(
      verifyMetaWebhookSignature({
        rawBody: Buffer.from(BODY, "utf8"),
        signature: sign(BODY),
        appSecret: SECRET,
      }),
    ).toBe(true);
  });

  it("fails closed when no app secret is configured", () => {
    expect(
      verifyMetaWebhookSignature({ rawBody: BODY, signature: sign(BODY), appSecret: undefined }),
    ).toBe(false);
    const original = process.env.META_APP_SECRET;
    delete process.env.META_APP_SECRET;
    try {
      expect(verifyMetaWebhookSignature({ rawBody: BODY, signature: sign(BODY) })).toBe(false);
    } finally {
      if (original !== undefined) process.env.META_APP_SECRET = original;
    }
  });

  it("reads META_APP_SECRET from the environment by default", () => {
    const original = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = SECRET;
    try {
      expect(verifyMetaWebhookSignature({ rawBody: BODY, signature: sign(BODY) })).toBe(true);
    } finally {
      if (original === undefined) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = original;
    }
  });

  it("constant-time compare never throws on equal-length mismatch", () => {
    const flipped = sign(BODY);
    const bad = `sha256=${flipped.slice(7).replace(/^./, flipped.endsWith("a") ? "b" : "a")}`;
    expect(() =>
      verifyMetaWebhookSignature({ rawBody: BODY, signature: bad, appSecret: SECRET }),
    ).not.toThrow();
    expect(verifyMetaWebhookSignature({ rawBody: BODY, signature: bad, appSecret: SECRET })).toBe(
      false,
    );
  });
});

describe("Meta webhook challenge handshake", () => {
  it("echoes the challenge for a valid subscription", () => {
    expect(
      verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: "tok", challenge: "42" }, "tok"),
    ).toBe("42");
  });

  it("rejects a wrong verify token", () => {
    expect(
      verifyMetaWebhookChallenge(
        { mode: "subscribe", verifyToken: "wrong", challenge: "42" },
        "tok",
      ),
    ).toBeNull();
  });

  it("rejects non-subscribe modes", () => {
    expect(
      verifyMetaWebhookChallenge(
        { mode: "unsubscribe", verifyToken: "tok", challenge: "42" },
        "tok",
      ),
    ).toBeNull();
    expect(
      verifyMetaWebhookChallenge({ mode: null, verifyToken: "tok", challenge: "42" }, "tok"),
    ).toBeNull();
  });

  it("rejects missing token or challenge", () => {
    expect(
      verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: null, challenge: "42" }, "tok"),
    ).toBeNull();
    expect(
      verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: "tok", challenge: null }, "tok"),
    ).toBeNull();
    expect(
      verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: "", challenge: "42" }, "tok"),
    ).toBeNull();
  });

  it("rejects tokens of a different length without throwing", () => {
    expect(
      verifyMetaWebhookChallenge(
        { mode: "subscribe", verifyToken: "much-longer-token", challenge: "42" },
        "tok",
      ),
    ).toBeNull();
  });

  it("fails closed when META_VERIFY_TOKEN is not configured", () => {
    const original = process.env.META_VERIFY_TOKEN;
    delete process.env.META_VERIFY_TOKEN;
    try {
      expect(
        verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: "tok", challenge: "42" }),
      ).toBeNull();
    } finally {
      if (original !== undefined) process.env.META_VERIFY_TOKEN = original;
    }
  });

  it("reads META_VERIFY_TOKEN from the environment by default", () => {
    const original = process.env.META_VERIFY_TOKEN;
    process.env.META_VERIFY_TOKEN = "env-token";
    try {
      expect(
        verifyMetaWebhookChallenge({ mode: "subscribe", verifyToken: "env-token", challenge: "c" }),
      ).toBe("c");
    } finally {
      if (original === undefined) delete process.env.META_VERIFY_TOKEN;
      else process.env.META_VERIFY_TOKEN = original;
    }
  });

  it("uses constant-time comparison for the verify token", () => {
    const nearMiss = "tolk";
    expect(
      verifyMetaWebhookChallenge(
        { mode: "subscribe", verifyToken: nearMiss, challenge: "42" },
        "tokl",
      ),
    ).toBeNull();
  });
});
