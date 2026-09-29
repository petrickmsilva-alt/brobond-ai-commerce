import { describe, expect, it } from "vitest";
import {
  MockPaymentProvider,
  normalizePaymentCurrency,
  resolvePaymentProviderName,
} from "@/modules/payments/provider";

describe("payments/checkout provider", () => {
  it("normalizes payment currencies defensively", () => {
    expect(normalizePaymentCurrency("usd")).toBe("USD");
    expect(normalizePaymentCurrency("BRL")).toBe("BRL");
    expect(normalizePaymentCurrency("ABCD")).toBe("BRL");
  });

  it("chooses the mock provider when no live provider is configured", () => {
    expect(
      resolvePaymentProviderName({
        NODE_ENV: "test",
        PAYMENT_PROVIDER: undefined,
        STRIPE_SECRET_KEY: undefined,
      } as NodeJS.ProcessEnv),
    ).toBe("mock");
    expect(
      resolvePaymentProviderName({
        NODE_ENV: "test",
        PAYMENT_PROVIDER: "mock",
        STRIPE_SECRET_KEY: "sk_test",
      } as NodeJS.ProcessEnv),
    ).toBe("mock");
  });

  it("returns a checkout session payload for a mock provider", async () => {
    const provider = new MockPaymentProvider();
    const session = await provider.createCheckoutSession({
      organizationId: "org_123",
      amountCents: 42_000,
      currency: "brl",
      quantity: 1,
      reference: "ref-1",
    });

    expect(session.provider).toBe("mock");
    expect(session.amountCents).toBe(42_000);
    expect(session.currency).toBe("BRL");
    expect(session.url).toContain("checkout");
  });
});
