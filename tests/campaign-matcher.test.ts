import { describe, expect, it } from "vitest";
import { recommendCreators } from "@/modules/campaigns/matching/matcher";

const campaign = { id: "campaign-1", audienceType: "SCORE" as const };
const products = [
  { id: "p1", name: "Top Fitness", slug: "top-fitness", marginBps: 5000, niche: "Fitness" },
  { id: "p2", name: "Terno", slug: "terno", marginBps: 1000, niche: "Executivo" },
];
const creators = [
  { id: "c1", creatorScore: 90, niche: "Fitness" },
  { id: "c2", creatorScore: 70, niche: "Executivo" },
];
const matches = [
  { productId: "p1", confidence: 1 },
  { productId: "p2", confidence: 0.5 },
];
const trends = [
  { trendScore: 80, category: "Fitness" },
  { trendScore: 60, category: "Executivo" },
];

describe("recommendCreators", () => {
  it("ranks every eligible creator/product pair by score", () => {
    const result = recommendCreators(campaign, products, creators, matches, trends);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({
      creatorId: "c1",
      productId: "p1",
      matchScore: 81,
      nicheMatch: true,
    });
    expect(result.map((item) => item.matchScore)).toEqual(
      [...result].map((item) => item.matchScore).sort((a, b) => b - a),
    );
  });
  it("applies every campaign rule before scoring", () => {
    const result = recommendCreators(campaign, products, creators, matches, trends, {
      minimumCreatorScore: 80,
      minimumTrendScore: 70,
      minimumProductMargin: 4000,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.creatorId).toBe("c1");
  });
  it("filters non-matching creators for NICHE audiences", () => {
    const result = recommendCreators(
      { ...campaign, audienceType: "NICHE" },
      products,
      creators,
      matches,
      trends,
      { preferredNiche: "Fitness" },
    );
    expect(result.every((item) => item.creatorId === "c1")).toBe(true);
  });
  it("does not automatically build MANUAL or inactive audiences", () => {
    expect(
      recommendCreators(
        { ...campaign, audienceType: "MANUAL" },
        products,
        creators,
        matches,
        trends,
      ),
    ).toEqual([]);
    expect(
      recommendCreators(campaign, products, creators, matches, trends, { active: false }),
    ).toEqual([]);
  });
  it("uses ProductMatch confidence to attenuate trend relevance", () => {
    const result = recommendCreators(campaign, products, creators, matches, trends);
    expect(
      result.find((item) => item.productId === "p2" && item.creatorId === "c2")?.trendScore,
    ).toBe(30);
  });
  it("has stable id tiebreakers and is deterministic", () => {
    const a = recommendCreators(campaign, products, creators, matches, trends);
    const b = recommendCreators(campaign, products, creators, matches, trends);
    expect(a).toEqual(b);
  });
});
