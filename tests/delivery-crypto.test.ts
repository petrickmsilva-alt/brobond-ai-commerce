import { describe, expect, it } from "vitest";
import {
  DeliveryCryptoError,
  decodeMetaEncryptionKey,
  decryptDeliverySecret,
  encryptDeliverySecret,
  hashDeliveryOAuthState,
} from "@/modules/delivery/core/crypto.service";

const KEY = Buffer.alloc(32, 7).toString("base64url");
const HEX_KEY = Buffer.alloc(32, 3).toString("hex");
const B64_KEY = Buffer.alloc(32, 5).toString("base64");

describe("Delivery credential crypto (AES-256-GCM)", () => {
  it("encrypts with AES-256-GCM and decrypts round-trip", () => {
    const cipher = encryptDeliverySecret("meta-access-token", KEY);
    expect(cipher).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(cipher).not.toContain("meta-access-token");
    expect(decryptDeliverySecret(cipher, KEY)).toBe("meta-access-token");
  });

  it("produces versioned v1.iv.tag.ciphertext segments", () => {
    const parts = encryptDeliverySecret("token", KEY).split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1]!, "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[2]!, "base64url")).toHaveLength(16);
    expect(parts[3]!.length).toBeGreaterThan(0);
  });

  it("uses a fresh IV per encryption (equal plaintexts diverge)", () => {
    expect(encryptDeliverySecret("same-token", KEY)).not.toBe(
      encryptDeliverySecret("same-token", KEY),
    );
  });

  it("round-trips unicode and long secrets", () => {
    const secret = `tok-🔐-${"x".repeat(500)}`;
    expect(decryptDeliverySecret(encryptDeliverySecret(secret, KEY), KEY)).toBe(secret);
  });

  it("accepts a base64url key", () => {
    const cipher = encryptDeliverySecret("k1", KEY);
    expect(decryptDeliverySecret(cipher, KEY)).toBe("k1");
  });

  it("accepts a standard base64 key", () => {
    const cipher = encryptDeliverySecret("k2", B64_KEY);
    expect(decryptDeliverySecret(cipher, B64_KEY)).toBe("k2");
  });

  it("accepts a 64-char hex key", () => {
    const cipher = encryptDeliverySecret("k3", HEX_KEY);
    expect(decryptDeliverySecret(cipher, HEX_KEY)).toBe("k3");
  });

  it("hex and base64url encodings of the same bytes are interchangeable", () => {
    const raw = Buffer.alloc(32, 9);
    const cipher = encryptDeliverySecret("interop", raw.toString("base64url"));
    expect(decryptDeliverySecret(cipher, raw.toString("hex"))).toBe("interop");
  });

  it("rejects a wrong key with an authentication failure", () => {
    const cipher = encryptDeliverySecret("secret", KEY);
    expect(() => decryptDeliverySecret(cipher, Buffer.alloc(32, 8).toString("base64url"))).toThrow(
      DeliveryCryptoError,
    );
  });

  it("rejects a tampered auth tag", () => {
    const [version, iv, tag, ciphertext] = encryptDeliverySecret("secret", KEY).split(".");
    const flipped = Buffer.from(tag!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() =>
      decryptDeliverySecret(
        [version, iv, flipped.toString("base64url"), ciphertext].join("."),
        KEY,
      ),
    ).toThrow(DeliveryCryptoError);
  });

  it("rejects a tampered ciphertext", () => {
    const [version, iv, tag, ciphertext] = encryptDeliverySecret("secret", KEY).split(".");
    const flipped = Buffer.from(ciphertext!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() =>
      decryptDeliverySecret([version, iv, tag, flipped.toString("base64url")].join("."), KEY),
    ).toThrow(DeliveryCryptoError);
  });

  it("rejects a tampered IV", () => {
    const [version, iv, tag, ciphertext] = encryptDeliverySecret("secret", KEY).split(".");
    const flipped = Buffer.from(iv!, "base64url");
    flipped[3] = flipped[3]! ^ 128;
    expect(() =>
      decryptDeliverySecret(
        [version, flipped.toString("base64url"), tag, ciphertext].join("."),
        KEY,
      ),
    ).toThrow(DeliveryCryptoError);
  });

  it("rejects ciphertext with a wrong version marker", () => {
    const [, iv, tag, ciphertext] = encryptDeliverySecret("secret", KEY).split(".");
    expect(() => decryptDeliverySecret(["v2", iv, tag, ciphertext].join("."), KEY)).toThrow(
      /format/i,
    );
  });

  it("rejects malformed ciphertext (missing segments)", () => {
    expect(() => decryptDeliverySecret("v1.only-two", KEY)).toThrow(DeliveryCryptoError);
    expect(() => decryptDeliverySecret("", KEY)).toThrow(DeliveryCryptoError);
    expect(() => decryptDeliverySecret("v1.a.b.c.d", KEY)).toThrow(DeliveryCryptoError);
  });

  it("rejects an IV with the wrong length", () => {
    const [, , tag, ciphertext] = encryptDeliverySecret("secret", KEY).split(".");
    const badIv = Buffer.alloc(8, 1).toString("base64url");
    expect(() => decryptDeliverySecret(["v1", badIv, tag, ciphertext].join("."), KEY)).toThrow(
      DeliveryCryptoError,
    );
  });

  it("requires a 32-byte key instead of hashing a passphrase", () => {
    expect(() => encryptDeliverySecret("secret", "short-key")).toThrow(/32 bytes/);
    expect(() => decodeMetaEncryptionKey("abc")).toThrow(DeliveryCryptoError);
  });

  it("requires META_ENCRYPTION_KEY when no key is passed", () => {
    const original = process.env.META_ENCRYPTION_KEY;
    delete process.env.META_ENCRYPTION_KEY;
    try {
      expect(() => encryptDeliverySecret("secret")).toThrow(/META_ENCRYPTION_KEY is required/);
      expect(() => decodeMetaEncryptionKey(undefined)).toThrow(DeliveryCryptoError);
    } finally {
      if (original !== undefined) process.env.META_ENCRYPTION_KEY = original;
    }
  });

  it("reads the key from META_ENCRYPTION_KEY by default", () => {
    const original = process.env.META_ENCRYPTION_KEY;
    process.env.META_ENCRYPTION_KEY = KEY;
    try {
      const cipher = encryptDeliverySecret("env-secret");
      expect(decryptDeliverySecret(cipher)).toBe("env-secret");
    } finally {
      if (original === undefined) delete process.env.META_ENCRYPTION_KEY;
      else process.env.META_ENCRYPTION_KEY = original;
    }
  });

  it("refuses to encrypt an empty credential", () => {
    expect(() => encryptDeliverySecret("", KEY)).toThrow(DeliveryCryptoError);
  });

  it("never leaks plaintext inside the ciphertext", () => {
    const cipher = encryptDeliverySecret("EAABsupersecretvalue", KEY);
    expect(Buffer.from(cipher, "utf8").includes("EAABs")).toBe(false);
    for (const segment of cipher.split(".").slice(1)) {
      expect(Buffer.from(segment, "base64url").includes("EAABs")).toBe(false);
    }
  });

  it("hashes OAuth state one-way and deterministically", () => {
    expect(hashDeliveryOAuthState("state-a")).toHaveLength(64);
    expect(hashDeliveryOAuthState("state-a")).toBe(hashDeliveryOAuthState("state-a"));
    expect(hashDeliveryOAuthState("state-a")).not.toBe(hashDeliveryOAuthState("state-b"));
  });

  it("state hash never exposes the original state", () => {
    const hash = hashDeliveryOAuthState("super-opaque-state-value");
    expect(hash).not.toContain("super-opaque-state-value");
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });

  it("distinguishes near-identical states (avalanche)", () => {
    expect(hashDeliveryOAuthState("state-1")).not.toBe(hashDeliveryOAuthState("state-2"));
  });
});

describe("decodeMetaEncryptionKey edge cases", () => {
  it("trims surrounding whitespace", () => {
    expect(decodeMetaEncryptionKey(`  ${KEY}  `)).toHaveLength(32);
  });

  it("rejects a 64-char non-hex string", () => {
    expect(() => decodeMetaEncryptionKey("z".repeat(64))).toThrow(DeliveryCryptoError);
  });

  it("rejects base64 that decodes to 16 bytes", () => {
    expect(() => decodeMetaEncryptionKey(Buffer.alloc(16, 1).toString("base64url"))).toThrow(
      /32 bytes/,
    );
  });

  it("rejects base64 that decodes to 64 bytes", () => {
    expect(() => decodeMetaEncryptionKey(Buffer.alloc(64, 1).toString("base64url"))).toThrow(
      /32 bytes/,
    );
  });

  it("rejects an empty string", () => {
    expect(() => decodeMetaEncryptionKey("")).toThrow(DeliveryCryptoError);
  });
});
