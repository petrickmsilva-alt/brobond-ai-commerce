import { describe, expect, it } from "vitest";
import {
  DeliveryConfigurationError,
  DeliveryConnectorNotRegisteredError,
  DeliveryError,
  DeliveryProviderError,
  DeliveryStateError,
} from "@/modules/delivery/core/delivery.interface";

describe("Delivery error hierarchy", () => {
  it("every error extends DeliveryError and Error", () => {
    const errors = [
      new DeliveryConfigurationError("a"),
      new DeliveryStateError("b"),
      new DeliveryConnectorNotRegisteredError("c"),
      new DeliveryProviderError("d", { status: 500 }),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(DeliveryError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("each subclass carries a distinct, stable name", () => {
    expect(new DeliveryError("x").name).toBe("DeliveryError");
    expect(new DeliveryConfigurationError("x").name).toBe("DeliveryConfigurationError");
    expect(new DeliveryStateError("x").name).toBe("DeliveryStateError");
    expect(new DeliveryConnectorNotRegisteredError("x").name).toBe(
      "DeliveryConnectorNotRegisteredError",
    );
    expect(new DeliveryProviderError("x", { status: 400 }).name).toBe("DeliveryProviderError");
  });
});

describe("DeliveryProviderError retry semantics", () => {
  it("408 is retryable", () => {
    expect(new DeliveryProviderError("t", { status: 408 }).retryable).toBe(true);
  });

  it("429 is retryable", () => {
    expect(new DeliveryProviderError("t", { status: 429 }).retryable).toBe(true);
  });

  it.each([500, 502, 503, 504, 599])("%i is retryable", (status) => {
    expect(new DeliveryProviderError("t", { status }).retryable).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])("%i is NOT retryable", (status) => {
    expect(new DeliveryProviderError("t", { status }).retryable).toBe(false);
  });

  it("status 0 (network failure) is not retryable by default", () => {
    expect(new DeliveryProviderError("t", { status: 0 }).retryable).toBe(false);
  });

  it("an explicit retryable flag overrides the status heuristic", () => {
    expect(new DeliveryProviderError("t", { status: 400, retryable: true }).retryable).toBe(true);
    expect(new DeliveryProviderError("t", { status: 500, retryable: false }).retryable).toBe(false);
    expect(new DeliveryProviderError("down", { status: 0, retryable: true }).retryable).toBe(true);
  });

  it("exposes status and provider code", () => {
    const error = new DeliveryProviderError("rate limited", { status: 429, code: 4 });
    expect(error.status).toBe(429);
    expect(error.code).toBe(4);
    expect(error.message).toBe("rate limited");
  });

  it("code is optional", () => {
    expect(new DeliveryProviderError("x", { status: 500 }).code).toBeUndefined();
  });
});
