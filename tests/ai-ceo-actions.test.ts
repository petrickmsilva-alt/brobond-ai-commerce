import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";

const requireManagerMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const generateDecisionsMock = vi.hoisted(() => vi.fn());
const generateReportMock = vi.hoisted(() => vi.fn());
const transitionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({
  requireManager: requireManagerMock,
  requireAdmin: requireAdminMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/modules/ai-ceo/repositories/ai-ceo.repository", () => ({
  DecisionNotFoundError: class DecisionNotFoundError extends Error {},
}));
vi.mock("@/modules/ai-ceo/services/ai-ceo.service", () => ({
  aiCeoService: {
    generateExecutiveDecisions: generateDecisionsMock,
    generateExecutiveReport: generateReportMock,
    transitionDecision: transitionMock,
  },
}));

const {
  generateExecutiveDecisionsAction,
  generateExecutiveReportAction,
  transitionExecutiveDecisionAction,
} = await import("@/app/dashboard/ceo/actions");

const manager = {
  id: "manager_1",
  organizationId: "org_a",
  role: "MANAGER",
};
const admin = { ...manager, id: "admin_1", role: "ADMIN" };

describe("AI CEO actions and RBAC — PR011", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireManagerMock.mockResolvedValue(manager);
    requireAdminMock.mockResolvedValue(admin);
    generateDecisionsMock.mockResolvedValue({
      runId: "run_1",
      summary: "summary",
      opportunities: 6,
      decisions: 5,
    });
    generateReportMock.mockResolvedValue({ id: "report_1" });
    transitionMock.mockResolvedValue({ id: "decision_1", status: "APPROVED" });
  });

  it("allows MANAGER+ to generate tenant-scoped advisory decisions", async () => {
    const result = await generateExecutiveDecisionsAction();
    expect(result).toMatchObject({ ok: true, data: { runId: "run_1", decisions: 5 } });
    expect(generateDecisionsMock).toHaveBeenCalledWith("org_a", "manager_1");
  });

  it("denies decision generation to an underprivileged caller", async () => {
    requireManagerMock.mockRejectedValue(new AuthorizationError("Forbidden", 403));
    const result = await generateExecutiveDecisionsAction();
    expect(result.ok).toBe(false);
    expect(generateDecisionsMock).not.toHaveBeenCalled();
  });

  it("allows MANAGER+ to generate the daily report", async () => {
    const result = await generateExecutiveReportAction();
    expect(result).toEqual({ ok: true, data: { reportId: "report_1" } });
    expect(generateReportMock).toHaveBeenCalledWith("org_a", "manager_1");
  });

  it("requires ADMIN for approval", async () => {
    await transitionExecutiveDecisionAction({ decisionId: "decision_1", status: "APPROVED" });
    expect(requireAdminMock).toHaveBeenCalledOnce();
    expect(transitionMock).toHaveBeenCalledWith("org_a", "decision_1", "APPROVED", "admin_1");
  });

  it("requires ADMIN for rejection", async () => {
    await transitionExecutiveDecisionAction({ decisionId: "decision_1", status: "REJECTED" });
    expect(transitionMock).toHaveBeenCalledWith("org_a", "decision_1", "REJECTED", "admin_1");
  });

  it("requires ADMIN for external execution acknowledgement", async () => {
    await transitionExecutiveDecisionAction({ decisionId: "decision_1", status: "EXECUTED" });
    expect(transitionMock).toHaveBeenCalledWith("org_a", "decision_1", "EXECUTED", "admin_1");
  });

  it("denies every transition when ADMIN guard fails", async () => {
    requireAdminMock.mockRejectedValue(new AuthorizationError("Forbidden", 403));
    const result = await transitionExecutiveDecisionAction({
      decisionId: "decision_1",
      status: "APPROVED",
    });
    expect(result.ok).toBe(false);
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it("rejects PENDING as a client transition target", async () => {
    const result = await transitionExecutiveDecisionAction({
      decisionId: "decision_1",
      status: "PENDING",
    });
    expect(result.ok).toBe(false);
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it("never trusts a client-supplied organization or actor", async () => {
    await transitionExecutiveDecisionAction({
      decisionId: "decision_1",
      status: "APPROVED",
      organizationId: "org_evil",
      actorId: "attacker",
    });
    expect(transitionMock).toHaveBeenCalledWith("org_a", "decision_1", "APPROVED", "admin_1");
  });

  it("revalidates the CEO dashboard only after success", async () => {
    await generateExecutiveDecisionsAction();
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/ceo");
    revalidatePathMock.mockClear();
    generateDecisionsMock.mockRejectedValue(new Error("OpenAI unavailable"));
    const result = await generateExecutiveDecisionsAction();
    expect(result.ok).toBe(false);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
