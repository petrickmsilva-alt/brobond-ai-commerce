import { describe, expect, it } from "vitest";
import {
  computeTikTokWebhookSignature,
  verifyTikTokWebhookSignature,
} from "@/modules/connectors/tiktok/webhooks/verifier";

describe("TikTok Shop webhook verifier", () => {
  const appKey = "app-key";
  const appSecret = "app-secret";
  const rawBody =
    '{"tts_notification_id":"evt-1","shop_id":"shop-1","event_type":"product.updated"}';

  it("verifies the official HMAC over app_key + exact raw body", () => {
    const signature = computeTikTokWebhookSignature(rawBody, appKey, appSecret);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyTikTokWebhookSignature({ rawBody, signature, appKey, appSecret })).toBe(true);
  });

  it("rejects tampering, malformed signatures and body reserialization", () => {
    const signature = computeTikTokWebhookSignature(rawBody, appKey, appSecret);
    expect(
      verifyTikTokWebhookSignature({ rawBody: `${rawBody} `, signature, appKey, appSecret }),
    ).toBe(false);
    expect(
      verifyTikTokWebhookSignature({ rawBody, signature: "Bearer token", appKey, appSecret }),
    ).toBe(false);
    expect(
      verifyTikTokWebhookSignature({ rawBody, signature: "0".repeat(64), appKey, appSecret }),
    ).toBe(false);
  });
});
