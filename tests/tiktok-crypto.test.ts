import { describe, expect, it } from "vitest";
import {
  TikTokCryptoError,
  decryptTikTokSecret,
  encryptTikTokSecret,
  hashOAuthState,
} from "@/modules/connectors/tiktok/auth/crypto.service";

const KEY = Buffer.alloc(32, 7).toString("base64url");

describe("TikTok token crypto", () => {
  it("encrypts with AES-256-GCM and decrypts round-trip", () => {
    const cipher = encryptTikTokSecret("access-token-value", KEY);
    expect(cipher).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(cipher).not.toContain("access-token-value");
    expect(decryptTikTokSecret(cipher, KEY)).toBe("access-token-value");
  });

  it("uses a fresh IV, so equal tokens have different ciphertext", () => {
    expect(encryptTikTokSecret("same", KEY)).not.toBe(encryptTikTokSecret("same", KEY));
  });

  it("rejects tampered ciphertext and incorrect keys", () => {
    const encrypted = encryptTikTokSecret("refresh-token", KEY);
    const [version, iv, tag, ciphertext] = encrypted.split(".");
    const changedTag = Buffer.from(tag!, "base64url");
    changedTag[0] = changedTag[0]! ^ 1;
    const tampered = [version, iv, changedTag.toString("base64url"), ciphertext].join(".");
    expect(() => decryptTikTokSecret(tampered, KEY)).toThrow(TikTokCryptoError);
    expect(() => decryptTikTokSecret(encrypted, Buffer.alloc(32, 8).toString("base64url"))).toThrow(
      TikTokCryptoError,
    );
  });

  it("requires a 32 byte encryption key instead of hashing a passphrase", () => {
    expect(() => encryptTikTokSecret("secret", "short-key")).toThrow(/32 bytes/);
  });

  it("hashes OAuth state one-way and deterministically", () => {
    expect(hashOAuthState("state-a")).toHaveLength(64);
    expect(hashOAuthState("state-a")).toBe(hashOAuthState("state-a"));
    expect(hashOAuthState("state-a")).not.toBe(hashOAuthState("state-b"));
  });
});
