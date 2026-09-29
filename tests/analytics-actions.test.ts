import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";

const requireManagerMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({ requireManager: requireManagerMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/modules/analytics/services/analytics.service", () => ({
  analyticsService: { refresh: refreshMock },
}));

const { refreshAnalyticsAction } = await import("@/app/dashboard/analytics/actions");

const manager = {
  id: "user_1",
  email: "manager@brobond.ai",
  name: "Manager",
  image: null,
  role: "MANAGER",
  organizationId: "org_a",
};

describe("refreshAnalyticsAction() — PR008", () => {
  beforeEach(() => {
    requireManagerMock.mockReset();
    revalidatePathMock.mockReset();
    refreshMock.mockReset();

    requireManagerMock.mockResolvedValue(manager);
    refreshMock.mockResolvedValue({
      period: { from: "a", to: "b", days: 30 },
      metrics: {},
      computedAt: "2026-09-22T14:00:00.000Z",
      stale: false,
      source: "refreshed",
    });
  });

  it("rejects an unauthenticated or underprivileged caller", async () => {
    requireManagerMock.mockRejectedValue(new AuthorizationError("Forbidden", 403));
    const result = await refreshAnalyticsAction({ days: 30 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload (zod)", async () => {
    const result = await refreshAnalyticsAction({ days: 9999 });
    expect(result.ok).toBe(false);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refreshes the snapshot for the CALLER's tenant only", async () => {
    const result = await refreshAnalyticsAction({ days: 30 });
    expect(result.ok).toBe(true);
    expect(refreshMock).toHaveBeenCalledWith("org_a", { days: 30 });
    expect(result.computedAt).toBe("2026-09-22T14:00:00.000Z");
  });

  it("never accepts a tenant id from the client", async () => {
    await refreshAnalyticsAction({ days: 7, organizationId: "org_evil" });
    const call = refreshMock.mock.calls[0];
    expect(call?.[0]).toBe("org_a");
    expect(call?.[1]).toEqual({ days: 7 });
  });

  it("revalidates the analytics path only on success", async () => {
    await refreshAnalyticsAction({ days: 30 });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/analytics");

    revalidatePathMock.mockClear();
    refreshMock.mockRejectedValue(new Error("db down"));
    const result = await refreshAnalyticsAction({ days: 30 });
    expect(result.ok).toBe(false);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces unexpected errors with a generic-safe message body", async () => {
    refreshMock.mockRejectedValue(new AuthorizationError("Unauthorized", 401));
    const result = await refreshAnalyticsAction({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Você não tem permissão para executar esta ação.");
  });
});
