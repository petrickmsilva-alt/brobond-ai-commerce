import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Marketplace credential crypto (PR012) — AES-256-GCM.
 *
 * Every OAuth2 token / API key persisted on the unified `Connector` model
 * passes through this service. Plaintext credentials are NEVER stored,
 * NEVER selected into dashboard DTOs and NEVER returned to the browser.
 *
 * Ciphertext format (versioned, rotation-ready):
 *   `v1.<iv base64url>.<auth-tag base64url>.<ciphertext base64url>`
 *
 * Same contract as `modules/delivery/core/crypto.service.ts` (PR010), keyed
 * by CONNECTOR_ENCRYPTION_KEY so marketplace credentials rotate
 * independently from the Meta delivery credentials.
 */

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export class ConnectorCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorCryptoError";
  }
}

/** Decodes a strict 32-byte AES key; passphrases are never silently hashed. */
export function decodeConnectorEncryptionKey(value: string | undefined): Buffer {
  if (!value) throw new ConnectorCryptoError("CONNECTOR_ENCRYPTION_KEY is required.");
  const trimmed = value.trim();
  const candidate = /^[a-fA-F0-9]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64url");
  if (candidate.length !== KEY_BYTES) {
    throw new ConnectorCryptoError(
      "CONNECTOR_ENCRYPTION_KEY must decode to exactly 32 bytes (base64/base64url or 64-character hex).",
    );
  }
  return candidate;
}

/** Encrypt a credential using versioned AES-256-GCM ciphertext. */
export function encryptConnectorSecret(
  plaintext: string,
  keyValue = process.env.CONNECTOR_ENCRYPTION_KEY,
): string {
  if (!plaintext) throw new ConnectorCryptoError("Cannot encrypt an empty connector credential.");
  const key = decodeConnectorEncryptionKey(keyValue);
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

/** Decrypts a versioned AES-256-GCM credential and rejects any tampering. */
export function decryptConnectorSecret(
  ciphertext: string,
  keyValue = process.env.CONNECTOR_ENCRYPTION_KEY,
): string {
  const [version, ivEncoded, tagEncoded, valueEncoded, ...extra] = ciphertext.split(".");
  if (version !== VERSION || !ivEncoded || !tagEncoded || !valueEncoded || extra.length > 0) {
    throw new ConnectorCryptoError("Invalid encrypted connector credential format.");
  }
  try {
    const iv = Buffer.from(ivEncoded, "base64url");
    const tag = Buffer.from(tagEncoded, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) {
      throw new ConnectorCryptoError("Invalid encrypted connector credential parameters.");
    }
    const decipher = createDecipheriv(ALGORITHM, decodeConnectorEncryptionKey(keyValue), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(valueEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof ConnectorCryptoError) throw error;
    throw new ConnectorCryptoError("Unable to decrypt connector credential.");
  }
}

/** OAuth state tokens are persisted as one-way digests, never as values. */
export function hashConnectorOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/** HMAC-SHA256 (hex) helper shared by the Shopee / Mercado Pago signers. */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Masked preview of a credential for the dashboard (e.g. the Mercado Pago
 * public key): keeps the last 4 characters, hides everything else. The
 * masked value can never be reversed into the original credential.
 */
export function maskConnectorSecretPreview(plaintext: string): string {
  return `••••${plaintext.slice(-4)}`;
}
