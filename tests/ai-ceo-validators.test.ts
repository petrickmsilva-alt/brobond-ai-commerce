import { describe, expect, it } from "vitest";
import {
  decisionTransitionSchema,
  executiveReportResponseSchema,
  executiveStrategyResponseSchema,
} from "@/modules/ai-ceo/validators";

const validDecision = {
  opportunityKey: "product:p1:creator-coverage",
  title: "Expandir cobertura",
  description: "Descrição",
  reason: "Razão",
  confidence: 0.84,
};

const invalidStrategyPayloads: unknown[] = [
  null,
  {},
  { summary: "", decisions: [] },
  { summary: "ok" },
  { summary: "ok", decisions: "not-array" },
  { summary: "ok", decisions: [{ ...validDecision, opportunityKey: "" }] },
  { summary: "ok", decisions: [{ ...validDecision, title: "" }] },
  { summary: "ok", decisions: [{ ...validDecision, description: "" }] },
  { summary: "ok", decisions: [{ ...validDecision, reason: "" }] },
  { summary: "ok", decisions: [{ ...validDecision, confidence: -0.01 }] },
  { summary: "ok", decisions: [{ ...validDecision, confidence: 1.01 }] },
  { summary: "ok", decisions: [{ ...validDecision, confidence: "high" }] },
  { summary: "ok", decisions: [{ ...validDecision, extra: "forbidden" }] },
  { summary: "ok", decisions: Array.from({ length: 21 }, () => validDecision) },
  { summary: "ok", decisions: [], extra: "forbidden" },
];

describe("AI CEO validators — PR011", () => {
  it.each(invalidStrategyPayloads.map((payload, index) => [index, payload] as const))(
    "rejects hostile/malformed strategy payload #%s",
    (_index, payload) => {
      expect(executiveStrategyResponseSchema.safeParse(payload).success).toBe(false);
    },
  );

  it("accepts and trims a valid strategy response", () => {
    const parsed = executiveStrategyResponseSchema.parse({
      summary: "  resumo  ",
      decisions: [{ ...validDecision, title: "  título  " }],
    });
    expect(parsed.summary).toBe("resumo");
    expect(parsed.decisions[0]?.title).toBe("título");
  });

  it.each(["APPROVED", "REJECTED", "EXECUTED"] as const)(
    "accepts the human transition %s",
    (status) => {
      expect(decisionTransitionSchema.parse({ decisionId: "decision_1", status })).toEqual({
        decisionId: "decision_1",
        status,
      });
    },
  );

  it.each(["PENDING", "CANCELLED", "approved", "", null])(
    "rejects transition target %s",
    (status) => {
      expect(decisionTransitionSchema.safeParse({ decisionId: "decision_1", status }).success).toBe(
        false,
      );
    },
  );

  it("never accepts an empty decision id", () => {
    expect(
      decisionTransitionSchema.safeParse({ decisionId: " ", status: "APPROVED" }).success,
    ).toBe(false);
  });

  it("validates every executive report section", () => {
    expect(
      executiveReportResponseSchema.parse({
        summary: "Operação estável.",
        risks: ["ROI abaixo da meta"],
        opportunities: ["Creator premium"],
      }),
    ).toEqual({
      summary: "Operação estável.",
      risks: ["ROI abaixo da meta"],
      opportunities: ["Creator premium"],
    });
  });

  it.each([
    { summary: "", risks: [], opportunities: [] },
    { summary: "ok", risks: "risk", opportunities: [] },
    { summary: "ok", risks: [], opportunities: "opportunity" },
    { summary: "ok", risks: [""], opportunities: [] },
    { summary: "ok", risks: [], opportunities: [""] },
    { summary: "ok", risks: [], opportunities: [], extra: true },
  ])("rejects malformed report %#", (payload) => {
    expect(executiveReportResponseSchema.safeParse(payload).success).toBe(false);
  });
});
