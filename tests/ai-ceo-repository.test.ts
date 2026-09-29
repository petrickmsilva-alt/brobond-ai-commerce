import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import {
  createAICeoRepository,
  DecisionNotFoundError,
} from "@/modules/ai-ceo/repositories/ai-ceo.repository";
import { InvalidDecisionTransitionError } from "@/modules/ai-ceo/engine/decision.engine";
import { executiveContextFixture } from "./ai-ceo-fixture";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

function fakeDb(status = "PENDING") {
  const aIDecisionRun = {
    create: vi.fn(async ({ data }) => ({
      id: "run_1",
      ...data,
      decisions: data.decisions.create.map((decision: object, index: number) => ({
        id: `decision_${index}`,
        ...decision,
        evidence: [],
      })),
    })),
  };
  const aIDecision = {
    findFirst: vi.fn(async () =>
      status === "MISSING"
        ? null
        : {
            id: "decision_1",
            organizationId: "org_a",
            status,
          },
    ),
    update: vi.fn(async ({ where, data }) => ({
      id: where.id,
      organizationId: "org_a",
      ...data,
    })),
  };
  const executiveReport = {
    create: vi.fn(async ({ data }) => ({ id: "report_1", ...data })),
  };
  const auditLog = { create: vi.fn(async ({ data }) => ({ id: "audit_1", ...data })) };
  const tx = { aIDecisionRun, aIDecision, executiveReport, auditLog };
  return {
    db: {
      ...tx,
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never,
    aIDecisionRun,
    aIDecision,
    executiveReport,
    auditLog,
  };
}

const decision = {
  sourceKey: "product:p1:creator-coverage",
  title: "Expandir cobertura",
  description: "Descrição",
  reason: "Razão",
  priority: "HIGH" as const,
  status: "PENDING" as const,
  confidence: 0.88,
  category: "PRODUCT",
  potentialRevenueCents: 500_000,
  evidence: [
    { sourceType: "Product", sourceId: "p1", weight: 0.75 },
    { sourceType: "AnalyticsSnapshot", sourceId: "s1", weight: 0.25 },
  ],
};

describe("AI CEO repository, evidence and audit — PR011", () => {
  let fake: ReturnType<typeof fakeDb>;
  let repository: ReturnType<typeof createAICeoRepository>;

  beforeEach(() => {
    fake = fakeDb();
    repository = createAICeoRepository(fake.db);
  });

  it("persists the complete context and raw OpenAI response", async () => {
    const context = executiveContextFixture();
    await repository.persistGeneration("org_a", {
      context,
      decisions: [decision],
      promptVersion: "ai-ceo-strategist@1.0.0",
      model: "gpt-4o-mini",
      temperature: 0.3,
      inputTokens: 100,
      outputTokens: 50,
      rawResponse: { summary: "ok", decisions: [] },
      actorId: "admin_1",
    });
    const data = fake.aIDecisionRun.create.mock.calls[0]?.[0].data;
    expect(data.inputSnapshot).toEqual(context);
    expect(data.rawResponse).toEqual({ summary: "ok", decisions: [] });
    expect(data.temperature).toBe(0.3);
  });

  it("persists source type, source id and weight for every evidence", async () => {
    await repository.persistGeneration("org_a", {
      context: executiveContextFixture(),
      decisions: [decision],
      promptVersion: "v1",
      model: "model",
      temperature: 0.3,
      inputTokens: 0,
      outputTokens: 0,
      rawResponse: {},
      actorId: "admin_1",
    });
    const nested = fake.aIDecisionRun.create.mock.calls[0]?.[0].data.decisions.create[0];
    expect(nested.evidence.create).toEqual(decision.evidence);
  });

  it("forces every nested decision into PENDING", async () => {
    await repository.persistGeneration("org_a", {
      context: executiveContextFixture(),
      decisions: [decision],
      promptVersion: "v1",
      model: "model",
      temperature: 0.3,
      inputTokens: 0,
      outputTokens: 0,
      rawResponse: {},
      actorId: "admin_1",
    });
    const nested = fake.aIDecisionRun.create.mock.calls[0]?.[0].data.decisions.create[0];
    expect(nested.status).toBe("PENDING");
  });

  it("writes a generation audit event with the actor", async () => {
    await repository.persistGeneration("org_a", {
      context: executiveContextFixture(),
      decisions: [decision],
      promptVersion: "v1",
      model: "model",
      temperature: 0.3,
      inputTokens: 0,
      outputTokens: 0,
      rawResponse: {},
      actorId: "admin_1",
    });
    expect(fake.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_a",
        action: "AI_CEO_DECISIONS_GENERATED",
        metadata: expect.objectContaining({ actorId: "admin_1" }),
      }),
    });
  });

  it.each([
    ["APPROVED", "approvedAt"],
    ["REJECTED", "rejectedAt"],
  ] as const)("transitions PENDING to %s with %s", async (target, timestamp) => {
    const now = new Date("2026-09-23T15:00:00.000Z");
    const updated = await repository.transition("org_a", "decision_1", target, "admin_1", now);
    expect(updated.status).toBe(target);
    expect(fake.aIDecision.update).toHaveBeenCalledWith({
      where: { id: "decision_1" },
      data: expect.objectContaining({ status: target, [timestamp]: now }),
    });
  });

  it("allows APPROVED to be marked EXECUTED without calling an operational dependency", async () => {
    fake = fakeDb("APPROVED");
    repository = createAICeoRepository(fake.db);
    await repository.transition("org_a", "decision_1", "EXECUTED", "admin_1");
    expect(fake.aIDecision.update).toHaveBeenCalledOnce();
    expect(fake.auditLog.create).toHaveBeenCalledOnce();
    expect(Object.keys(fake.db)).toEqual(
      expect.not.arrayContaining(["campaign", "outreachMessage", "deliveryMessage"]),
    );
  });

  it("rejects an invalid lifecycle transition before update/audit", async () => {
    fake = fakeDb("REJECTED");
    repository = createAICeoRepository(fake.db);
    await expect(
      repository.transition("org_a", "decision_1", "EXECUTED", "admin_1"),
    ).rejects.toBeInstanceOf(InvalidDecisionTransitionError);
    expect(fake.aIDecision.update).not.toHaveBeenCalled();
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("hides a missing/foreign decision as not found", async () => {
    fake = fakeDb("MISSING");
    repository = createAICeoRepository(fake.db);
    await expect(
      repository.transition("org_a", "foreign_id", "APPROVED", "admin_1"),
    ).rejects.toBeInstanceOf(DecisionNotFoundError);
  });

  it("rejects a blank tenant before any query", async () => {
    await expect(
      repository.transition("", "decision_1", "APPROVED", "admin_1"),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(fake.aIDecision.findFirst).not.toHaveBeenCalled();
  });

  it("persists all required daily report sections and raw response", async () => {
    const context = executiveContextFixture();
    await repository.persistReport("org_a", {
      context,
      summary: "Resumo",
      risks: ["Risco"],
      opportunities: ["Oportunidade"],
      promptVersion: "ai-ceo-daily-report@1.0.0",
      model: "gpt-4o-mini",
      temperature: 0.3,
      inputTokens: 10,
      outputTokens: 20,
      rawResponse: { summary: "Resumo", risks: ["Risco"], opportunities: ["Oportunidade"] },
      actorId: "manager_1",
      now: new Date("2026-09-23T18:00:00.000Z"),
    });
    expect(fake.executiveReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        summary: "Resumo",
        gmvCents: context.analytics.gmvCents,
        roiBps: context.analytics.roiBps,
        creators: context.creators.length,
        products: context.products.length,
        campaigns: context.campaigns.length,
        risks: ["Risco"],
        opportunities: ["Oportunidade"],
        rawResponse: expect.any(Object),
      }),
    });
  });
});
