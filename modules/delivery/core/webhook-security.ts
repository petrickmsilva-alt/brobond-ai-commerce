import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta webhook security (PR010 §9) — shared by the Instagram and WhatsApp
 * ingress routes.
 *
 * Meta signs every webhook POST with `X-Hub-Signature-256`:
 *   `sha256=<hex HMAC-SHA256(rawBody, META_APP_SECRET)>`
 * Verification runs in constant time over the EXACT raw request bytes and
 * any mismatch is rejected with an immediate 401 — before parsing, before
 * tenant resolution, before any database write.
 *
 * The GET handshake (`hub.mode=subscribe`, `hub.verify_token`,
 * `hub.challenge`) proves webhook ownership with `META_VERIFY_TOKEN`.
 */

export const META_SIGNATURE_HEADER = "x-hub-signature-256";
const SIGNATURE_PREFIX = "sha256=";

export function computeMetaWebhookSignature(rawBody: string | Buffer, appSecret: string): string {
  return `${SIGNATURE_PREFIX}${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/**
 * Constant-time validation of the Meta signature. Any deviation — missing
 * header, wrong scheme, malformed hex, length mismatch — fails closed.
 */
export function verifyMetaWebhookSignature(input: {
  rawBody: string | Buffer;
  signature: string | null | undefined;
  appSecret?: string;
}): boolean {
  const appSecret = input.appSecret ?? process.env.META_APP_SECRET;
  const provided = input.signature?.trim().toLowerCase();
  if (!appSecret || !provided || !provided.startsWith(SIGNATURE_PREFIX)) return false;
  const hex = provided.slice(SIGNATURE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(hex)) return false;
  const expected = computeMetaWebhookSignature(input.rawBody, appSecret);
  const expectedBuffer = Buffer.from(expected.slice(SIGNATURE_PREFIX.length), "hex");
  const providedBuffer = Buffer.from(hex, "hex");
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export interface MetaWebhookChallenge {
  mode: string | null;
  verifyToken: string | null;
  challenge: string | null;
}

/**
 * Validate the subscription handshake. Returns the challenge to echo when
 * (and only when) the mode and verify token match, otherwise `null` — the
 * caller maps that to 401.
 */
export function verifyMetaWebhookChallenge(
  input: MetaWebhookChallenge,
  expectedVerifyToken = process.env.META_VERIFY_TOKEN,
): string | null {
  if (!expectedVerifyToken) return null;
  if (input.mode !== "subscribe") return null;
  if (!input.verifyToken || !input.challenge) return null;
  const expected = Buffer.from(expectedVerifyToken, "utf8");
  const provided = Buffer.from(input.verifyToken, "utf8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return input.challenge;
}
