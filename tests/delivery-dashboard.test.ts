import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryMessage } from "@prisma/client";
import { createDeliveryDashboard } from "@/modules/delivery/dashboard.service";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const NOW = new Date("2026-09-23T12:00:00.000Z");

function messageRow(overrides: Partial<DeliveryMessage> = {}): DeliveryMessage {
  return {
    id: "m1",
    organizationId: "org_1",
    executionId: "exec-1",
    channel: "WHATSAPP",
    recipientId: "+5511999",
    recipientName: "Ana",
    status: "READ",
    providerMessageId: "wamid-1",
    payload: { campaignId: "c1", campaignName: "One", message: { type: "text", text: "oi" } },
    sentAt: new Date(NOW.getTime() - 10_000),
    deliveredAt: new Date(NOW.getTime() - 7_000),
    readAt: new Date(NOW.getTime() - 3_000),
    attempts: 1,
    lastAttemptAt: NOW,
    nextAttemptAt: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as DeliveryMessage;
}

function fakeRepository() {
  return {
    listAccounts: vi.fn(async (org: string) => [
      {
        id: "a1",
        organizationId: org,
        channel: "INSTAGRAM" as const,
        accountId: "ig-1",
        accountName: "@shop",
        expiresAt: null,
        status: "CONNECTED" as const,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]),
    statusCounts: vi.fn(async () => ({ QUEUED: 2, SENT: 1, DELIVERED: 1, READ: 3, FAILED: 1 })),
    listCampaignFacets: vi.fn(async () => [{ campaignId: "c1", campaignName: "One" }]),
    listAuditLogs: vi.fn(async () => [
      {
        id: "l1",
        action: "WHATSAPP_CONNECTED",
        entityType: "DeliveryAccount",
        entityId: "a1",
        createdAt: NOW,
      },
    ]),
    listMessages: vi.fn(async (_org: string, _filters: unknown) => ({
      rows: [messageRow()],
      total: 41,
    })),
  };
}

describe("Delivery dashboard service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("composes accounts, KPIs, campaigns and logs from the tenant", async () => {
    const repository = fakeRepository();
    const service = createDeliveryDashboard({ repository: repository as never });
    const dashboard = await service.getDashboard("org_1");
    expect(dashboard.accounts).toHaveLength(1);
    expect(dashboard.accounts[0]).not.toHaveProperty("encryptedAccessToken");
    expect(dashboard.kpis).toEqual({
      queued: 2,
      sent: 5,
      delivered: 4,
      read: 3,
      failed: 1,
      cancelled: 0,
      draft: 0,
    });
    expect(dashboard.campaigns).toEqual([{ campaignId: "c1", campaignName: "One" }]);
    expect(dashboard.logs[0]!.createdAt).toBe(NOW.toISOString());
  });

  it("every repository call carries the tenant scope", async () => {
    const repository = fakeRepository();
    const service = createDeliveryDashboard({ repository: repository as never });
    await service.getDashboard("org_7");
    for (const spy of [
      repository.listAccounts,
      repository.statusCounts,
      repository.listCampaignFacets,
      repository.listAuditLogs,
    ]) {
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.every((call) => call[0] === "org_7")).toBe(true);
    }
  });

  it("listMessages maps rows to DTOs and computes totalPages", async () => {
    const repository = fakeRepository();
    const service = createDeliveryDashboard({ repository: repository as never });
    const page = await service.listMessages("org_1", {
      channel: undefined,
      status: undefined,
      campaignId: undefined,
      page: 2,
      pageSize: 20,
    });
    expect(page.totalPages).toBe(3);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      id: "m1",
      status: "READ",
      deliveryLatencyMs: 3_000,
      messagePreview: "oi",
    });
  });

  it("rejects a blank tenant on both read paths", async () => {
    const service = createDeliveryDashboard({ repository: fakeRepository() as never });
    await expect(service.getDashboard("")).rejects.toThrow(/organization scope/);
    await expect(
      service.listMessages("  ", {
        channel: undefined,
        status: undefined,
        campaignId: undefined,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow(/organization scope/);
  });
});
