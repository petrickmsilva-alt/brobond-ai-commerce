import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "@prisma/client";

/**
 * PR014 — `salesService.upsertIngestedSale` idempotency.
 *
 * The (organizationId, channel, externalOrderId) unique index is the last
 * line of defence against at-least-once webhook deliveries. These tests pin
 * the decision table that runs on top of it.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { salesService } from "@/modules/sales/sales.service";

const mockedFindUnique = vi.mocked(prisma.sale.findUnique);
const mockedCreate = vi.mocked(prisma.sale.create);
const mockedUpdate = vi.mocked(prisma.sale.update);

function existingSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "sale_1",
    reference: "ref_1",
    quantity: 1,
    amountCents: 10_000,
    currency: "BRL",
    status: "PAID",
    occurredAt: new Date("2026-10-01T10:00:00.000Z"),
    channel: "MERCADOLIVRE",
    externalOrderId: "123456789",
    organizationId: "org_1",
    productId: null,
    creatorId: null,
    campaignId: null,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  } as Sale;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertIngestedSale", () => {
  it("creates the sale when a PAID order arrives for the first time", async () => {
    mockedFindUnique.mockResolvedValue(null);
    mockedCreate.mockResolvedValue(existingSale());

    const result = await salesService.upsertIngestedSale("org_1", {
      channel: "MERCADOLIVRE",
      externalOrderId: "123456789",
      amountCents: 10_000,
      status: "PAID",
      currency: "BRL",
      quantity: 1,
      occurredAt: new Date("2026-10-01T10:00:00.000Z"),
    });

    expect(result.outcome).toBe("created");
    expect(mockedCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_1",
        channel: "MERCADOLIVRE",
        externalOrderId: "123456789",
        amountCents: 10_000,
        status: "PAID",
        currency: "BRL",
      }),
    });
  });

  it("looks the sale up on the tenant-scoped ingestion key", async () => {
    mockedFindUnique.mockResolvedValue(null);
    mockedCreate.mockResolvedValue(existingSale());

    await salesService.upsertIngestedSale("org_1", {
      channel: "MERCADOPAGO",
      externalOrderId: "pay-001",
      amountCents: 500,
      status: "PAID",
    });

    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: {
        organizationId_channel_externalOrderId: {
          organizationId: "org_1",
          channel: "MERCADOPAGO",
          externalOrderId: "pay-001",
        },
      },
    });
  });

  it("an identical replay is unchanged — no second write, no double revenue", async () => {
    mockedFindUnique.mockResolvedValue(existingSale());

    const result = await salesService.upsertIngestedSale("org_1", {
      channel: "MERCADOLIVRE",
      externalOrderId: "123456789",
      amountCents: 10_000,
      status: "PAID",
    });

    expect(result.outcome).toBe("unchanged");
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("a pending notification for an unknown order never creates a sale", async () => {
    mockedFindUnique.mockResolvedValue(null);

    const result = await salesService.upsertIngestedSale("org_1", {
      channel: "MERCADOPAGO",
      externalOrderId: "pay-002",
      amountCents: 9_900,
      status: "PENDING",
    });

    expect(result).toMatchObject({ outcome: "ignored", sale: null });
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("a paid sale can be refunded by a later webhook", async () => {
    mockedFindUnique.mockResolvedValue(existingSale({ status: "PAID" }));
    mockedUpdate.mockResolvedValue(existingSale({ status: "REFUNDED" }));

    const result = await salesService.upsertIngestedSale("org_1", {
      channel: "MERCADOLIVRE",
      externalOrderId: "123456789",
      amountCents: 10_000,
      status: "REFUNDED",
    });

    expect(result.outcome).toBe("updated");
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "sale_1" },
      data: expect.objectContaining({ status: "REFUNDED" }),
    });
  });

  it("a terminal sale is never downgraded by a replayed PAID notification", async () => {
    mockedFindUnique.mockResolvedValue(existingSale({ status: "REFUNDED" }));

    const result = await salesService.upsertIngestedSale("org_1", {
      channel: "MERCADOLIVRE",
      externalOrderId: "123456789",
      amountCents: 10_000,
      status: "PAID",
    });

    expect(result.outcome).toBe("unchanged");
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("settling a pending sale refreshes the settlement timestamp", async () => {
    const settledAt = new Date("2026-10-01T12:00:00.000Z");
    mockedFindUnique.mockResolvedValue(
      existingSale({ status: "PENDING", occurredAt: new Date("2026-10-01T11:00:00.000Z") }),
    );
    mockedUpdate.mockResolvedValue(existingSale({ status: "PAID", occurredAt: settledAt }));

    const result = await salesService.upsertIngestedSale("org_1", {
      channel: "MERCADOLIVRE",
      externalOrderId: "123456789",
      amountCents: 10_000,
      status: "PAID",
      occurredAt: settledAt,
    });

    expect(result.outcome).toBe("updated");
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "sale_1" },
      data: expect.objectContaining({ occurredAt: settledAt }),
    });
  });

  it("rejects an empty external order id", async () => {
    await expect(
      salesService.upsertIngestedSale("org_1", {
        channel: "MERCADOLIVRE",
        externalOrderId: "   ",
        amountCents: 100,
        status: "PAID",
      }),
    ).rejects.toThrow(/identificador externo/i);
  });
});
