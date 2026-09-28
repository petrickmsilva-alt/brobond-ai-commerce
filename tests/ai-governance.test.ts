import { describe, expect, it, vi } from "vitest";
import {
  AIGovernanceError,
  createAIGovernanceService,
  getAIGovernanceConfig,
} from "@/modules/ai-governance";

function fakeDb(costCents = 0) {
  const agentRun = {
    aggregate: vi.fn(async () => ({ _sum: { costCents } })),
    create: vi.fn(async ({ data }) => ({ id: "run_1", ...data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  return {
    db: {
      agentRun,
      agentToolCall: { create: vi.fn() },
      approvalRequest: { findFirst: vi.fn(async () => null), create: vi.fn(), updateMany: vi.fn() },
    },
    agentRun,
  };
}

describe("AI governance", () => {
  it("defaults the global autonomy kill switch to disabled", () => {
    expect(getAIGovernanceConfig({})).toMatchObject({ enabled: false });
  });

  it("persists a blocked run when the kill switch is disabled", async () => {
    const fake = fakeDb();
    const service = createAIGovernanceService(fake.db as never, () => ({
      enabled: false,
      runBudgetCents: 10,
      periodBudgetCents: 100,
      periodHours: 24,
    }));
    await expect(
      service.startRun({ organizationId: "org_a", trigger: "test", model: "test", input: {} }),
    ).rejects.toMatchObject({ code: "AI_AUTONOMY_DISABLED" });
    expect(fake.agentRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "BLOCKED" }) }),
    );
  });

  it("blocks external tools unless a human approval is approved for that tenant and run", async () => {
    const fake = fakeDb();
    const service = createAIGovernanceService(fake.db as never, () => ({
      enabled: true,
      runBudgetCents: 10,
      periodBudgetCents: 100,
      periodHours: 24,
    }));
    await expect(
      service.recordToolCall({
        organizationId: "org_a",
        agentRunId: "run_1",
        tool: "send-message",
        toolInput: { token: "secret" },
        externalEffect: true,
      }),
    ).rejects.toBeInstanceOf(AIGovernanceError);
    expect(fake.db.agentToolCall.create).not.toHaveBeenCalled();
  });

  it("rejects a tenant after the configured period budget is exhausted", async () => {
    const fake = fakeDb(100);
    const service = createAIGovernanceService(fake.db as never, () => ({
      enabled: true,
      runBudgetCents: 10,
      periodBudgetCents: 100,
      periodHours: 24,
    }));
    await expect(
      service.startRun({ organizationId: "org_a", trigger: "test", model: "test", input: {} }),
    ).rejects.toMatchObject({ code: "AI_BUDGET_EXCEEDED" });
  });
});
