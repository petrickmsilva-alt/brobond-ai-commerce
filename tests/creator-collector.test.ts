import { describe, expect, it } from "vitest";
import { CreatorSource } from "@prisma/client";
import {
  MOCK_CREATOR_CANDIDATES,
  MOCK_FOLLOWERS_MAX,
  MOCK_FOLLOWERS_MIN,
  MOCK_NICHE_DISTRIBUTION,
  MockCreatorCollector,
} from "@/modules/creators/discovery/collectors/MockCreatorCollector";
import { InstagramCreatorCollector } from "@/modules/creators/discovery/collectors/InstagramCreatorCollector";
import { ShopeeCreatorCollector } from "@/modules/creators/discovery/collectors/ShopeeCreatorCollector";
import { TikTokCreatorCollector } from "@/modules/creators/discovery/collectors/TikTokCreatorCollector";
import { creatorCandidateSchema } from "@/modules/creators/crm/validators/creator.validator";
import { scoreCreator } from "@/modules/creators/discovery/scorer";
import type { CreatorCandidate } from "@/modules/creators/interfaces/creator.interface";

/**
 * PR003 — the MOCK collector and its deterministic dataset.
 *
 * The dataset is the PR003 contract: exactly 100 candidates, niche
 * distribution Moda 35 · Casual 20 · Street 20 · Fitness 15 ·
 * Executivo 10, followers 5k–2M, all valid against the Zod schema.
 */

function nicheCounts(candidates: readonly CreatorCandidate[]): Record<string, number> {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.niche] = (counts[candidate.niche] ?? 0) + 1;
    return counts;
  }, {});
}

describe("MOCK_CREATOR_CANDIDATES (dataset)", () => {
  it("contains exactly 100 candidates", () => {
    expect(MOCK_CREATOR_CANDIDATES).toHaveLength(100);
  });

  it("matches the PR003 niche distribution (35/20/20/15/10)", () => {
    expect(nicheCounts(MOCK_CREATOR_CANDIDATES)).toEqual({
      Moda: 35,
      Casual: 20,
      Street: 20,
      Fitness: 15,
      Executivo: 10,
    });
  });

  it("declares the same distribution it produces", () => {
    const declared = Object.fromEntries(
      MOCK_NICHE_DISTRIBUTION.map(([niche, count]) => [niche, count]),
    );
    expect(nicheCounts(MOCK_CREATOR_CANDIDATES)).toEqual(declared);
    const total = MOCK_NICHE_DISTRIBUTION.reduce((sum, [, count]) => sum + count, 0);
    expect(total).toBe(100);
  });

  it("keeps followers between 5k and 2M (inclusive bounds)", () => {
    for (const candidate of MOCK_CREATOR_CANDIDATES) {
      expect(candidate.followers).toBeGreaterThanOrEqual(MOCK_FOLLOWERS_MIN);
      expect(candidate.followers).toBeLessThanOrEqual(MOCK_FOLLOWERS_MAX);
    }
  });

  it("has at least one profile near each follower bound (dataset is not degenerate)", () => {
    const followers = MOCK_CREATOR_CANDIDATES.map((c) => c.followers);
    expect(Math.min(...followers)).toBeLessThan(MOCK_FOLLOWERS_MIN + 500_000);
    expect(Math.max(...followers)).toBeGreaterThan(MOCK_FOLLOWERS_MAX - 500_000);
  });

  it("has unique externalIds", () => {
    const ids = new Set(MOCK_CREATOR_CANDIDATES.map((c) => c.externalId));
    expect(ids.size).toBe(MOCK_CREATOR_CANDIDATES.length);
  });

  it("has unique handles", () => {
    const handles = new Set(MOCK_CREATOR_CANDIDATES.map((c) => c.handle));
    expect(handles.size).toBe(MOCK_CREATOR_CANDIDATES.length);
  });

  it("every handle is canonical (lowercase, single leading @)", () => {
    for (const candidate of MOCK_CREATOR_CANDIDATES) {
      expect(candidate.handle).toMatch(/^@[a-z0-9._]+$/);
    }
  });

  it("every candidate passes the Zod ingestion schema", () => {
    for (const candidate of MOCK_CREATOR_CANDIDATES) {
      expect(() => creatorCandidateSchema.parse(candidate)).not.toThrow();
    }
  });

  it("every candidate scores within 0–100", () => {
    for (const candidate of MOCK_CREATOR_CANDIDATES) {
      const { creatorScore } = scoreCreator(candidate);
      expect(creatorScore).toBeGreaterThanOrEqual(0);
      expect(creatorScore).toBeLessThanOrEqual(100);
    }
  });

  it("carries 1–2 tags from the niche vocabulary", () => {
    for (const candidate of MOCK_CREATOR_CANDIDATES) {
      expect(candidate.tags?.length).toBeGreaterThanOrEqual(1);
      expect(candidate.tags?.length).toBeLessThanOrEqual(2);
    }
  });

  it("is frozen (the source of truth cannot be mutated)", () => {
    expect(Object.isFrozen(MOCK_CREATOR_CANDIDATES)).toBe(true);
  });
});

describe("MockCreatorCollector", () => {
  it("implements the CreatorCollector interface with the MOCK source", () => {
    const collector = new MockCreatorCollector();
    expect(collector.source).toBe(CreatorSource.MOCK);
    expect(typeof collector.collect).toBe("function");
  });

  it("collect() returns exactly 100 candidates", async () => {
    const collector = new MockCreatorCollector();
    const candidates = await collector.collect();
    expect(candidates).toHaveLength(100);
  });

  it("is deterministic (two runs are deeply equal)", async () => {
    const collector = new MockCreatorCollector();
    const [first, second] = await Promise.all([collector.collect(), collector.collect()]);
    expect(first).toEqual(second);
  });

  it("is deterministic across instances (seeded PRNG)", async () => {
    const first = await new MockCreatorCollector().collect();
    const second = await new MockCreatorCollector().collect();
    expect(first).toEqual(second);
  });

  it("returns defensive copies (mutating a result never leaks into the source)", async () => {
    const collector = new MockCreatorCollector();
    const result = await collector.collect();
    result[0]!.handle = "@hacked";
    result.pop();
    const fresh = await collector.collect();
    expect(fresh).toHaveLength(100);
    expect(fresh[0]!.handle).not.toBe("@hacked");
    expect(MOCK_CREATOR_CANDIDATES[0]!.handle).not.toBe("@hacked");
  });
});

describe("Placeholder collectors (TikTok · Instagram · Shopee)", () => {
  it("declare their sources", () => {
    expect(new TikTokCreatorCollector().source).toBe(CreatorSource.TIKTOK);
    expect(new InstagramCreatorCollector().source).toBe(CreatorSource.INSTAGRAM);
    expect(new ShopeeCreatorCollector().source).toBe(CreatorSource.SHOPEE);
  });

  it("throw Not-Implemented on collect() (no network access in PR003)", async () => {
    await expect(new TikTokCreatorCollector().collect()).rejects.toThrow(/not implemented/i);
    await expect(new InstagramCreatorCollector().collect()).rejects.toThrow(/not implemented/i);
    await expect(new ShopeeCreatorCollector().collect()).rejects.toThrow(/not implemented/i);
  });
});
