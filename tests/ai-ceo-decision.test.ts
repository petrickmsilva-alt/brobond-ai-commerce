import { describe, expect, it } from "vitest";
import {
  assertDecisionTransition,
  canTransitionDecision,
  generateExecutiveDecisions,
  InvalidDecisionTransitionError,
  MAX_EXECUTIVE_DECISIONS,
} from "@/modules/ai-ceo/engine/decision.engine";
import { findRevenueOpportunities } from "@/modules/ai-ceo/engine/opportunity.engine";
import type { DecisionStatusName, RevenueOpportunity } from "@/modules/ai-ceo/dto";
import { executiveContextFixture } from "./ai-ceo-fixture";

const statuses: DecisionStatusName[] = ["PENDING", "APPROVED", "REJECTED", "EXECUTED"];
const allowed = new Set(["PENDING:APPROVED", "PENDING:REJECTED", "APPROVED:EXECUTED"]);
const transitionCases = statuses.flatMap((from) =>
  statuses.map((to) => ({ from, to, expected: allowed.has(`${from}:${to}`) })),
);

describe("AI CEO decision engine and approval flow — PR011", () => {
  it.each(transitionCases)("transition $from → $to is $expected", ({ from, to, expected }) => {
    expect(canTransitionDecision(from, to)).toBe(expected);
  });

  it("throws a typed error for an invalid transition", () => {
    expect(() => assertDecisionTransition("REJECTED", "APPROVED")).toThrow(
      InvalidDecisionTransitionError,
    );
  });

  it("allows the contracted PENDING → APPROVED → EXECUTED path", () => {
    expect(() => assertDecisionTransition("PENDING", "APPROVED")).not.toThrow();
    expect(() => assertDecisionTransition("APPROVED", "EXECUTED")).not.toThrow();
  });

  it("allows the contracted PENDING → REJECTED path", () => {
    expect(() => assertDecisionTransition("PENDING", "REJECTED")).not.toThrow();
  });

  it("creates only PENDING decisions", () => {
    const decisions = generateExecutiveDecisions(executiveContextFixture());
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((decision) => decision.status === "PENDING")).toBe(true);
  });

  it("uses AI wording only when it references a known opportunity key", () => {
    const context = executiveContextFixture();
    const opportunity = findRevenueOpportunities(context)[0]!;
    const decisions = generateExecutiveDecisions(context, [
      {
        opportunityKey: opportunity.key,
        title: "Título estratégico validado",
        description: "Descrição estratégica validada",
        reason: "Razão estratégica validada",
        confidence: 0.9,
      },
    ]);
    expect(decisions.find((item) => item.sourceKey === opportunity.key)).toMatchObject({
      title: "Título estratégico validado",
      description: "Descrição estratégica validada",
      reason: "Razão estratégica validada",
    });
  });

  it("discards model-invented opportunity keys", () => {
    const context = executiveContextFixture();
    const baseline = generateExecutiveDecisions(context);
    const decisions = generateExecutiveDecisions(context, [
      {
        opportunityKey: "invented:entity:42",
        title: "Inventada",
        description: "Inventada",
        reason: "Inventada",
        confidence: 1,
      },
    ]);
    expect(decisions).toEqual(baseline);
    expect(decisions.some((item) => item.sourceKey === "invented:entity:42")).toBe(false);
  });

  it("deduplicates repeated AI recommendations by opportunity key", () => {
    const context = executiveContextFixture();
    const opportunity = findRevenueOpportunities(context)[0]!;
    const recommendations = ["Primeira", "Segunda"].map((title) => ({
      opportunityKey: opportunity.key,
      title,
      description: title,
      reason: title,
      confidence: 0.8,
    }));
    const decisions = generateExecutiveDecisions(context, recommendations);
    expect(decisions.find((item) => item.sourceKey === opportunity.key)?.title).toBe("Primeira");
  });

  it("keeps evidence rule-derived even when OpenAI changes wording", () => {
    const context = executiveContextFixture();
    const opportunity = findRevenueOpportunities(context)[0]!;
    const [decision] = generateExecutiveDecisions(
      context,
      [
        {
          opportunityKey: opportunity.key,
          title: "AI",
          description: "AI",
          reason: "AI",
          confidence: 0.5,
        },
      ],
      [opportunity],
    );
    expect(
      decision?.evidence.map(({ sourceType, sourceId }) => ({ sourceType, sourceId })),
    ).toEqual(opportunity.evidence.map(({ sourceType, sourceId }) => ({ sourceType, sourceId })));
  });

  it("normalizes evidence weights to one", () => {
    const decision = generateExecutiveDecisions(executiveContextFixture())[0]!;
    const sum = decision.evidence.reduce((total, evidence) => total + evidence.weight, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it("filters a decision that has no auditable evidence", () => {
    const context = executiveContextFixture();
    const invalid: RevenueOpportunity = {
      key: "invalid",
      type: "OUTREACH_BACKLOG",
      category: "OPERATIONS",
      title: "Invalid",
      description: "Invalid",
      reason: "Invalid",
      confidence: 1,
      criteria: { roiBps: 0, potentialRevenueCents: 0, urgency: 0, trendScore: 0 },
      evidence: [],
    };
    expect(generateExecutiveDecisions(context, [], [invalid])).toEqual([]);
  });

  it("caps output to the executive decision limit", () => {
    const context = executiveContextFixture();
    context.products = Array.from({ length: 30 }, (_, index) => ({
      ...context.products[0]!,
      id: `product_${index}`,
      name: `Product ${index}`,
    }));
    expect(generateExecutiveDecisions(context)).toHaveLength(MAX_EXECUTIVE_DECISIONS);
  });

  it("sorts critical/high-value decisions ahead of low-value decisions", () => {
    const decisions = generateExecutiveDecisions(executiveContextFixture());
    const ranks = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    for (let index = 1; index < decisions.length; index += 1) {
      expect(ranks[decisions[index - 1]!.priority]).toBeGreaterThanOrEqual(
        ranks[decisions[index]!.priority],
      );
    }
  });

  it("never mutates context or supplied opportunities", () => {
    const context = executiveContextFixture();
    const opportunities = findRevenueOpportunities(context);
    const beforeContext = structuredClone(context);
    const beforeOpportunities = structuredClone(opportunities);
    generateExecutiveDecisions(context, [], opportunities);
    expect(context).toEqual(beforeContext);
    expect(opportunities).toEqual(beforeOpportunities);
  });
});
