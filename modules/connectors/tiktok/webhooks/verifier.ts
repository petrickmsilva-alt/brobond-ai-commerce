import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * TikTok Shop signs webhooks with lower-case hex HMAC-SHA256 over the exact
 * raw request bytes prefixed by app_key. This is intentionally distinct from
 * outbound TikTok API signing.
 */
export function computeTikTokWebhookSignature(
  rawBody: string | Buffer,
  appKey: string,
  appSecret: string,
): string {
  return createHmac("sha256", appSecret).update(appKey, "utf8").update(rawBody).digest("hex");
}

export function verifyTikTokWebhookSignature(input: {
  rawBody: string | Buffer;
  signature: string | null | undefined;
  appKey?: string;
  appSecret?: string;
}): boolean {
  const appKey = input.appKey ?? process.env.TIKTOK_APP_KEY;
  const appSecret = input.appSecret ?? process.env.TIKTOK_APP_SECRET;
  const actual = input.signature?.trim().toLowerCase();
  if (!appKey || !appSecret || !actual || !/^[a-f0-9]{64}$/.test(actual)) return false;
  const expected = computeTikTokWebhookSignature(input.rawBody, appKey, appSecret);
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
