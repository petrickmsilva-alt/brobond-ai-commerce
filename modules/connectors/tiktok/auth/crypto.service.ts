import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export class TikTokCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokCryptoError";
  }
}

/** Decodes a strict 32-byte AES key; passphrases are never silently hashed. */
export function decodeEncryptionKey(value: string | undefined): Buffer {
  if (!value) throw new TikTokCryptoError("TIKTOK_ENCRYPTION_KEY is required.");
  const trimmed = value.trim();
  const hex = /^[a-fA-F0-9]{64}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : null;
  const base64 = hex ?? Buffer.from(trimmed, "base64url");
  if (base64.length !== 32) {
    throw new TikTokCryptoError(
      "TIKTOK_ENCRYPTION_KEY must decode to exactly 32 bytes (base64/base64url or 64-character hex).",
    );
  }
  return base64;
}

/** Encrypt a secret using versioned AES-256-GCM ciphertext. */
export function encryptTikTokSecret(
  plaintext: string,
  keyValue = process.env.TIKTOK_ENCRYPTION_KEY,
): string {
  if (!plaintext) throw new TikTokCryptoError("Cannot encrypt an empty TikTok credential.");
  const key = decodeEncryptionKey(keyValue);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Decrypts a versioned AES-256-GCM secret and rejects any tampering. */
export function decryptTikTokSecret(
  ciphertext: string,
  keyValue = process.env.TIKTOK_ENCRYPTION_KEY,
): string {
  const [version, ivEncoded, tagEncoded, valueEncoded, ...extra] = ciphertext.split(".");
  if (version !== VERSION || !ivEncoded || !tagEncoded || !valueEncoded || extra.length > 0) {
    throw new TikTokCryptoError("Invalid encrypted TikTok credential format.");
  }
  try {
    const iv = Buffer.from(ivEncoded, "base64url");
    const tag = Buffer.from(tagEncoded, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) {
      throw new TikTokCryptoError("Invalid encrypted TikTok credential parameters.");
    }
    const decipher = createDecipheriv(ALGORITHM, decodeEncryptionKey(keyValue), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(valueEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof TikTokCryptoError) throw error;
    throw new TikTokCryptoError("Unable to decrypt TikTok credential.");
  }
}

/** State tokens are persisted as one-way digests, not retrievable values. */
export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}
