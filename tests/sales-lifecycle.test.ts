import { describe, expect, it } from "vitest";
import {
  canAcceptSalePayment,
  createRefundPlan,
  normalizeSaleCurrency,
  settleSalePayment,
} from "@/modules/sales/sales.service";
import { SaleStatus } from "@prisma/client";

describe("sales lifecycle — checkout and payment settlement", () => {
  it("normalizes currencies defensively", () => {
    expect(normalizeSaleCurrency("usd")).toBe("USD");
    expect(normalizeSaleCurrency("BRL")).toBe("BRL");
    expect(normalizeSaleCurrency("ABCD")).toBe("BRL");
  });

  it("accepts an exact payment for a pending sale", () => {
    const decision = canAcceptSalePayment(
      { amountCents: 15_000, currency: "BRL", status: SaleStatus.PENDING },
      { amountCents: 15_000, currency: "BRL" },
    );

    expect(decision.ok).toBe(true);
    expect(decision.reason).toBeUndefined();
    expect(decision.expectedAmountCents).toBe(15_000);
  });

  it("rejects mismatched payment values or currencies", () => {
    expect(
      canAcceptSalePayment(
        { amountCents: 15_000, currency: "BRL", status: SaleStatus.PENDING },
        { amountCents: 14_500, currency: "BRL" },
      ).ok,
    ).toBe(false);

    expect(
      canAcceptSalePayment(
        { amountCents: 15_000, currency: "BRL", status: SaleStatus.PENDING },
        { amountCents: 15_000, currency: "USD" },
      ).ok,
    ).toBe(false);
  });

  it("marks a sale as paid only when the settlement matches the original order", () => {
    const settled = settleSalePayment(
      { amountCents: 25_000, currency: "BRL", status: SaleStatus.PENDING },
      { amountCents: 25_000, currency: "BRL" },
    );

    expect(settled.status).toBe(SaleStatus.PAID);
    expect(settled.currency).toBe("BRL");
    expect(settled.paidAt).toBeInstanceOf(Date);
  });

  it("supports refund planning without exceeding the original sale amount", () => {
    const plan = createRefundPlan(
      { amountCents: 50_000, status: SaleStatus.PAID },
      75_000,
    );

    expect(plan.refundAmountCents).toBe(50_000);
    expect(plan.status).toBe(SaleStatus.REFUNDED);
  });

  it("blocks refunding a non-paid sale", () => {
    expect(() => createRefundPlan({ amountCents: 10_000, status: SaleStatus.PENDING }, 10_000)).toThrow(
      /Refund só pode ser gerado/i,
    );
  });
});
