import { describe, expect, it } from "vitest";
import { compareContextSnapshots, ROOT_DIFF_PATH } from "@/modules/ai/audit/context-diff";
import { serializeContext } from "@/modules/ai/personalization/context-builder";

const inputA = {
  creator: {
    id: "creator_1",
    displayName: "Ana Souza",
    handle: "ana.souza",
    niche: "Moda",
    score: 82,
  },
  product: { id: "product_1", name: "Jaqueta Bomber", margin: 3550 },
  campaign: { id: "campaign_1", name: "Lançamento Inverno" },
  trend: { keyword: "streetwear", score: 87 },
};

const inputB = {
  creator: {
    id: "creator_1",
    displayName: "Ana Souza",
    handle: "ana.souza",
    niche: "Moda",
    score: 91,
  },
  product: { id: "product_1", name: "Jaqueta Bomber", margin: 3990 },
  campaign: { id: "campaign_1", name: "Lançamento Inverno" },
  trend: { keyword: "y2k", score: 87 },
};

describe("compareContextSnapshots() — PR007.1", () => {
  it("returns an empty diff for identical snapshots", () => {
    const a = serializeContext(inputA);
    expect(compareContextSnapshots(a, a)).toEqual([]);
    expect(compareContextSnapshots(serializeContext(inputA), serializeContext(inputA))).toEqual([]);
  });

  it("reports creator.score, product.margin and trend.keyword field diffs", () => {
    const diffs = compareContextSnapshots(serializeContext(inputA), serializeContext(inputB));
    expect(diffs).toEqual([
      { path: "creator.score", before: 82, after: 91 },
      { path: "product.margin", before: 3550, after: 3990 },
      { path: "trend.keyword", before: "streetwear", after: "y2k" },
    ]);
  });

  it("reports only the fields that actually changed", () => {
    const changed = {
      ...inputA,
      creator: { ...inputA.creator, niche: "Fitness" },
    };
    const diffs = compareContextSnapshots(serializeContext(inputA), serializeContext(changed));
    expect(diffs).toEqual([{ path: "creator.niche", before: "Moda", after: "Fitness" }]);
  });

  it("reports a trend appearing (null → object)", () => {
    const withoutTrend = serializeContext({ ...inputA, trend: null });
    const withTrend = serializeContext(inputA);
    expect(compareContextSnapshots(withoutTrend, withTrend)).toEqual([
      {
        path: "trend",
        before: null,
        after: { keyword: "streetwear", score: 87 },
      },
    ]);
  });

  it("reports a trend disappearing (object → null)", () => {
    const withTrend = serializeContext(inputA);
    const withoutTrend = serializeContext({ ...inputA, trend: null });
    expect(compareContextSnapshots(withTrend, withoutTrend)).toEqual([
      {
        path: "trend",
        before: { keyword: "streetwear", score: 87 },
        after: null,
      },
    ]);
  });

  it("distinguishes null from a present value at leaf level", () => {
    const withScore = serializeContext(inputA);
    const withoutScore = serializeContext({
      ...inputA,
      creator: {
        id: "creator_1",
        displayName: "Ana Souza",
        handle: "ana.souza",
        niche: "Moda",
      },
    });
    expect(compareContextSnapshots(withScore, withoutScore)).toEqual([
      { path: "creator.score", before: 82, after: null },
    ]);
  });

  it("reports a whole-root type change with the root path", () => {
    const diffs = compareContextSnapshots(serializeContext(inputA), null);
    expect(diffs).toEqual([
      { path: ROOT_DIFF_PATH, before: serializeContext(inputA), after: null },
    ]);
  });

  it("detects a field only present in B (before is undefined)", () => {
    const diffs = compareContextSnapshots(
      { creator: { id: "c1" } },
      { creator: { id: "c1", score: 50 } },
    );
    expect(diffs).toEqual([{ path: "creator.score", before: undefined, after: 50 }]);
  });

  it("detects a field only present in A (after is undefined)", () => {
    const diffs = compareContextSnapshots(
      { creator: { id: "c1", score: 50 } },
      { creator: { id: "c1" } },
    );
    expect(diffs).toEqual([{ path: "creator.score", before: 50, after: undefined }]);
  });

  it("walks nested objects deterministically with sorted keys", () => {
    const diffs = compareContextSnapshots(
      { product: { margin: 1, name: "x" }, creator: { score: 2 } },
      { product: { margin: 9, name: "y" }, creator: { score: 8 } },
    );
    expect(diffs.map((diff) => diff.path)).toEqual([
      "creator.score",
      "product.margin",
      "product.name",
    ]);
  });

  it("treats NaN as equal to NaN", () => {
    expect(compareContextSnapshots({ a: NaN }, { a: NaN })).toEqual([]);
  });

  it("treats 0 and -0 as different leaves", () => {
    expect(compareContextSnapshots({ a: 0 }, { a: -0 })).toEqual([
      { path: "a", before: 0, after: -0 },
    ]);
  });

  it("compares arrays element by element using index paths", () => {
    const diffs = compareContextSnapshots(
      { hashtags: ["#a", "#b", "#c"] },
      { hashtags: ["#a", "#x"] },
    );
    expect(diffs).toEqual([
      { path: "hashtags.1", before: "#b", after: "#x" },
      { path: "hashtags.2", before: "#c", after: undefined },
    ]);
  });

  it("reports elements appended to an array", () => {
    const diffs = compareContextSnapshots({ list: [1] }, { list: [1, 2] });
    expect(diffs).toEqual([{ path: "list.1", before: undefined, after: 2 }]);
  });

  it("reports a type change at the same path (object vs leaf)", () => {
    const diffs = compareContextSnapshots({ a: { b: 1 } }, { a: 5 });
    expect(diffs).toEqual([{ path: "a", before: { b: 1 }, after: 5 }]);
  });

  it("reports array vs object as a single field change", () => {
    const diffs = compareContextSnapshots({ a: [1, 2] }, { a: { 0: 1, 1: 2 } });
    expect(diffs).toEqual([{ path: "a", before: [1, 2], after: { 0: 1, 1: 2 } }]);
  });

  it("returns an empty diff for two empty objects", () => {
    expect(compareContextSnapshots({}, {})).toEqual([]);
  });

  it("returns an empty diff when both roots are null", () => {
    expect(compareContextSnapshots(null, null)).toEqual([]);
  });

  it("ignores object identity — compares by value, not reference", () => {
    const a = { creator: { id: "c1", name: "Ana" } };
    const b = { creator: { id: "c1", name: "Ana" } };
    expect(compareContextSnapshots(a, b)).toEqual([]);
  });

  it("does not mutate the input snapshots", () => {
    const a = serializeContext(inputA);
    const b = serializeContext(inputB);
    const frozenA = JSON.parse(JSON.stringify(a));
    const frozenB = JSON.parse(JSON.stringify(b));
    compareContextSnapshots(a, b);
    expect(a).toEqual(frozenA);
    expect(b).toEqual(frozenB);
  });

  it("is insensitive to key insertion order in both inputs", () => {
    const a = serializeContext(inputA);
    const bShuffled = {
      campaign: { name: "Lançamento Verão", id: "campaign_2" },
      trend: { score: 87, keyword: "y2k" },
      product: { name: "Jaqueta Bomber", margin: 3550, id: "product_1" },
      creator: {
        niche: "Moda",
        score: 82,
        handle: "ana.souza",
        name: "Ana Souza",
        id: "creator_1",
      },
    };
    const diffs = compareContextSnapshots(a, bShuffled);
    expect(diffs.map((diff) => diff.path)).toEqual([
      "campaign.id",
      "campaign.name",
      "trend.keyword",
    ]);
  });
});
