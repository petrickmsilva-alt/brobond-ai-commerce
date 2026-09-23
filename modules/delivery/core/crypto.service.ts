import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Delivery credential crypto (PR010) — AES-256-GCM.
 *
 * Every Meta access/refresh token persisted on `DeliveryAccount` passes
 * through this service. Plaintext tokens are NEVER stored, NEVER selected
 * into dashboard DTOs and NEVER returned to the browser.
 *
 * Ciphertext format (versioned, rotation-ready):
 *   `v1.<iv base64url>.<auth-tag base64url>.<ciphertext base64url>`
 */

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export class DeliveryCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryCryptoError";
  }
}

/** Decodes a strict 32-byte AES key; passphrases are never silently hashed. */
export function decodeMetaEncryptionKey(value: string | undefined): Buffer {
  if (!value) throw new DeliveryCryptoError("META_ENCRYPTION_KEY is required.");
  const trimmed = value.trim();
  const candidate = /^[a-fA-F0-9]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64url");
  if (candidate.length !== KEY_BYTES) {
    throw new DeliveryCryptoError(
      "META_ENCRYPTION_KEY must decode to exactly 32 bytes (base64/base64url or 64-character hex).",
    );
  }
  return candidate;
}

/** Encrypt a secret using versioned AES-256-GCM ciphertext. */
export function encryptDeliverySecret(
  plaintext: string,
  keyValue = process.env.META_ENCRYPTION_KEY,
): string {
  if (!plaintext) throw new DeliveryCryptoError("Cannot encrypt an empty Meta credential.");
  const key = decodeMetaEncryptionKey(keyValue);
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
export function decryptDeliverySecret(
  ciphertext: string,
  keyValue = process.env.META_ENCRYPTION_KEY,
): string {
  const [version, ivEncoded, tagEncoded, valueEncoded, ...extra] = ciphertext.split(".");
  if (version !== VERSION || !ivEncoded || !tagEncoded || !valueEncoded || extra.length > 0) {
    throw new DeliveryCryptoError("Invalid encrypted Meta credential format.");
  }
  try {
    const iv = Buffer.from(ivEncoded, "base64url");
    const tag = Buffer.from(tagEncoded, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) {
      throw new DeliveryCryptoError("Invalid encrypted Meta credential parameters.");
    }
    const decipher = createDecipheriv(ALGORITHM, decodeMetaEncryptionKey(keyValue), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(valueEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof DeliveryCryptoError) throw error;
    throw new DeliveryCryptoError("Unable to decrypt Meta credential.");
  }
}

/** OAuth state tokens are persisted as one-way digests, never as values. */
export function hashDeliveryOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}
