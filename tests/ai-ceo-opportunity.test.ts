import { describe, expect, it } from "vitest";
import {
  findRevenueOpportunities,
  GROWING_TREND_SCORE,
  HIGH_MARGIN_BPS,
  PREMIUM_CREATOR_SCORE,
} from "@/modules/ai-ceo/engine/opportunity.engine";
import type { ExecutiveContext, RevenueOpportunityType } from "@/modules/ai-ceo/dto";
import { executiveContextFixture } from "./ai-ceo-fixture";

type Case = {
  name: string;
  type: RevenueOpportunityType;
  mutate: (context: ExecutiveContext) => void;
  expected: boolean;
};

const cases: Case[] = [
  {
    name: "product at high-margin threshold",
    type: "HIGH_MARGIN_LOW_CREATORS",
    mutate: (c) => (c.products[0]!.marginBps = HIGH_MARGIN_BPS),
    expected: true,
  },
  {
    name: "product below high-margin threshold",
    type: "HIGH_MARGIN_LOW_CREATORS",
    mutate: (c) => (c.products[0]!.marginBps = HIGH_MARGIN_BPS - 1),
    expected: false,
  },
  {
    name: "product with two creators",
    type: "HIGH_MARGIN_LOW_CREATORS",
    mutate: (c) => (c.products[0]!.creatorCount = 2),
    expected: true,
  },
  {
    name: "product with enough creators",
    type: "HIGH_MARGIN_LOW_CREATORS",
    mutate: (c) => (c.products[0]!.creatorCount = 3),
    expected: false,
  },
  {
    name: "product without stock",
    type: "HIGH_MARGIN_LOW_CREATORS",
    mutate: (c) => (c.products[0]!.stockQuantity = 0),
    expected: false,
  },
  {
    name: "inactive product",
    type: "HIGH_MARGIN_LOW_CREATORS",
    mutate: (c) => (c.products[0]!.status = "ARCHIVED"),
    expected: false,
  },
  {
    name: "growing trend at score threshold",
    type: "GROWING_TREND_NO_CAMPAIGN",
    mutate: (c) => (c.trends[0]!.trendScore = GROWING_TREND_SCORE),
    expected: true,
  },
  {
    name: "trend below score threshold",
    type: "GROWING_TREND_NO_CAMPAIGN",
    mutate: (c) => (c.trends[0]!.trendScore = GROWING_TREND_SCORE - 1),
    expected: false,
  },
  {
    name: "flat historical trend",
    type: "GROWING_TREND_NO_CAMPAIGN",
    mutate: (c) => (c.trends[0]!.growthBps = 0),
    expected: false,
  },
  {
    name: "new high-score trend",
    type: "GROWING_TREND_NO_CAMPAIGN",
    mutate: (c) => {
      c.trends[0]!.previousScore = null;
      c.trends[0]!.growthBps = 0;
      c.trends[0]!.trendScore = 80;
    },
    expected: true,
  },
  {
    name: "trend already covered by campaign",
    type: "GROWING_TREND_NO_CAMPAIGN",
    mutate: (c) => (c.trends[0]!.hasCampaign = true),
    expected: false,
  },
  {
    name: "creator at premium threshold",
    type: "PREMIUM_CREATOR_NO_CONTACT",
    mutate: (c) => (c.creators[0]!.score = PREMIUM_CREATOR_SCORE),
    expected: true,
  },
  {
    name: "creator below premium threshold",
    type: "PREMIUM_CREATOR_NO_CONTACT",
    mutate: (c) => (c.creators[0]!.score = PREMIUM_CREATOR_SCORE - 1),
    expected: false,
  },
  {
    name: "creator with existing contact",
    type: "PREMIUM_CREATOR_NO_CONTACT",
    mutate: (c) => (c.creators[0]!.outreachCount = 1),
    expected: false,
  },
  {
    name: "archived creator",
    type: "PREMIUM_CREATOR_NO_CONTACT",
    mutate: (c) => (c.creators[0]!.status = "ARCHIVED"),
    expected: false,
  },
  {
    name: "campaign one bps below target",
    type: "CAMPAIGN_ROI_BELOW_TARGET",
    mutate: (c) => (c.campaigns[0]!.roiBps = c.campaigns[0]!.targetRoiBps - 1),
    expected: true,
  },
  {
    name: "campaign exactly on target",
    type: "CAMPAIGN_ROI_BELOW_TARGET",
    mutate: (c) => (c.campaigns[0]!.roiBps = c.campaigns[0]!.targetRoiBps),
    expected: false,
  },
  {
    name: "draft campaign is not monitored",
    type: "CAMPAIGN_ROI_BELOW_TARGET",
    mutate: (c) => (c.campaigns[0]!.status = "DRAFT"),
    expected: false,
  },
  {
    name: "delivery failure rate above five percent",
    type: "DELIVERY_FAILURE_RISK",
    mutate: (c) => {
      c.delivery.sent = 95;
      c.delivery.failed = 5;
    },
    expected: true,
  },
  {
    name: "delivery without failures",
    type: "DELIVERY_FAILURE_RISK",
    mutate: (c) => (c.delivery.failed = 0),
    expected: false,
  },
  {
    name: "outreach backlog at threshold",
    type: "OUTREACH_BACKLOG",
    mutate: (c) => {
      c.outreach.ready = 15;
      c.outreach.scheduled = 5;
    },
    expected: true,
  },
  {
    name: "outreach backlog below threshold",
    type: "OUTREACH_BACKLOG",
    mutate: (c) => {
      c.outreach.ready = 14;
      c.outreach.scheduled = 5;
    },
    expected: false,
  },
];

describe("AI CEO revenue opportunity engine — PR011", () => {
  it.each(cases)("detects $name = $expected", ({ type, mutate, expected }) => {
    const context = executiveContextFixture();
    mutate(context);
    expect(findRevenueOpportunities(context).some((item) => item.type === type)).toBe(expected);
  });

  it("covers all four contracted revenue examples", () => {
    const types = findRevenueOpportunities(executiveContextFixture()).map((item) => item.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "HIGH_MARGIN_LOW_CREATORS",
        "GROWING_TREND_NO_CAMPAIGN",
        "PREMIUM_CREATOR_NO_CONTACT",
        "CAMPAIGN_ROI_BELOW_TARGET",
      ]),
    );
  });

  it("assigns verifiable evidence to every opportunity", () => {
    const opportunities = findRevenueOpportunities(executiveContextFixture());
    expect(opportunities.every((item) => item.evidence.length >= 2)).toBe(true);
    expect(
      opportunities.every((item) => item.evidence.some((evidence) => evidence.sourceId !== "")),
    ).toBe(true);
  });

  it("never returns negative potential revenue", () => {
    const context = executiveContextFixture();
    context.products[0]!.potentialRevenueCents = -999;
    context.creators[0]!.potentialRevenueCents = -999;
    expect(
      findRevenueOpportunities(context).every((item) => item.criteria.potentialRevenueCents >= 0),
    ).toBe(true);
  });

  it("returns deterministic stable ordering", () => {
    const first = findRevenueOpportunities(executiveContextFixture()).map((item) => item.key);
    const second = findRevenueOpportunities(executiveContextFixture()).map((item) => item.key);
    expect(first).toEqual(second);
  });

  it("does not mutate its input snapshot", () => {
    const context = executiveContextFixture();
    const before = structuredClone(context);
    findRevenueOpportunities(context);
    expect(context).toEqual(before);
  });
});
