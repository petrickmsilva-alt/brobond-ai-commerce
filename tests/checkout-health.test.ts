import { describe, expect, it } from "vitest";
import { evaluateCommerceHealth } from "@/modules/payments/health.service";

describe("checkout operational health", () => {
  it("flags mock provider as warning while remaining usable for local development", () => {
    const result = evaluateCommerceHealth("mock", true, false, true);
    expect(result.status).toBe("warning");
    expect(result.recommendations.some((item) => item.includes("PAYMENT_PROVIDER=stripe"))).toBe(
      true,
    );
  });

  it("marks live stripe config as healthy when webhook and secret are set", () => {
    const result = evaluateCommerceHealth("stripe", true, true, true);
    expect(result.status).toBe("healthy");
    expect(result.stripeReady).toBe(true);
  });

  it("flags a critical state when stripe is selected without the webhook secret", () => {
    const result = evaluateCommerceHealth("stripe", true, false, true);
    expect(result.status).toBe("critical");
    expect(result.recommendations.some((item) => item.includes("STRIPE_WEBHOOK_SECRET"))).toBe(
      true,
    );
  });
});
