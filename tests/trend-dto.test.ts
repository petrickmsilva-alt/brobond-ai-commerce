import { describe, expect, it } from "vitest";
import type { TrendCategory, TrendKeyword, TrendSnapshot } from "@prisma/client";
import {
  toCreateTrendDTO,
  toTrendCategoryDTO,
  toTrendKeywordDTO,
  toTrendSnapshotDTO,
  toTrendStatsDTO,
} from "@/modules/trends/dto/create-trend.dto";
import type { TrendSignal } from "@/modules/trends/interfaces/trend.interface";
import { calculateTrendScore } from "@/modules/trends/hunter/scorer";

/**
 * PR002 — Trend DTOs (RSC serialization boundary).
 *
 * Every DTO must be plain serializable data (ISO date strings, no Date
 * objects, no secrets, no tenant-foreign records).
 */

const SIGNAL: TrendSignal = {
  keyword: "camisa masculina",
  category: "Moda",
  views: 1_850_000,
  likes: 320_000,
  shares: 48_000,
  margin: 62,
  saturation: 22,
};

describe("toCreateTrendDTO", () => {
  it("maps a signal and computes the score with the engine", () => {
    const dto = toCreateTrendDTO(SIGNAL);
    expect(dto).toEqual({
      keyword: "camisa masculina",
      category: "Moda",
      views: 1_850_000,
      likes: 320_000,
      shares: 48_000,
      trendScore: calculateTrendScore(SIGNAL),
    });
  });

  it("uses an explicit score when provided (scheduler passes the precomputed one)", () => {
    const dto = toCreateTrendDTO(SIGNAL, 42);
    expect(dto.trendScore).toBe(42);
  });

  it("never carries an organizationId (injected by the repository)", () => {
    const dto = toCreateTrendDTO(SIGNAL);
    expect("organizationId" in dto).toBe(false);
  });

  it("round-trips a real mock signal through the pipeline", () => {
    // The full PR002 flow: signal → score → persistence payload.
    const dto = toCreateTrendDTO(SIGNAL);
    expect(dto.trendScore).toBe(89); // pinned expected score for the top mock trend
    expect(Number.isInteger(dto.trendScore)).toBe(true);
  });
});

describe("toTrendSnapshotDTO", () => {
  it("serializes dates as ISO strings", () => {
    const snapshot = {
      id: "snap_1",
      keyword: "polo slim",
      category: "Casual",
      views: 980_000,
      likes: 196_000,
      shares: 27_500,
      trendScore: 75,
      organizationId: "org_x",
      createdAt: new Date("2026-09-22T12:00:00.000Z"),
      updatedAt: new Date("2026-09-22T12:00:00.000Z"),
    } as TrendSnapshot;

    const dto = toTrendSnapshotDTO(snapshot);
    expect(dto.createdAt).toBe("2026-09-22T12:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-09-22T12:00:00.000Z");
    expect(typeof dto.createdAt).toBe("string");
  });

  it("keeps every table column", () => {
    const snapshot = {
      id: "snap_1",
      keyword: "polo slim",
      category: "Casual",
      views: 1,
      likes: 2,
      shares: 3,
      trendScore: 75,
      organizationId: "org_x",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TrendSnapshot;

    const dto = toTrendSnapshotDTO(snapshot);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "id",
        "keyword",
        "category",
        "views",
        "likes",
        "shares",
        "trendScore",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });
});

describe("toTrendKeywordDTO / toTrendCategoryDTO", () => {
  it("maps keyword rows with ISO dates", () => {
    const keyword = {
      id: "kw_1",
      keyword: "bermuda cargo",
      frequency: 4,
      organizationId: "org_x",
      createdAt: new Date("2026-09-22T10:00:00.000Z"),
      updatedAt: new Date("2026-09-22T10:00:00.000Z"),
    } as TrendKeyword;

    const dto = toTrendKeywordDTO(keyword);
    expect(dto.frequency).toBe(4);
    expect(dto.createdAt).toBe("2026-09-22T10:00:00.000Z");
  });

  it("maps category rows with ISO dates", () => {
    const category = {
      id: "cat_1",
      name: "Fitness",
      score: 88,
      organizationId: "org_x",
      createdAt: new Date("2026-09-22T09:00:00.000Z"),
      updatedAt: new Date("2026-09-22T09:00:00.000Z"),
    } as TrendCategory;

    const dto = toTrendCategoryDTO(category);
    expect(dto.name).toBe("Fitness");
    expect(dto.score).toBe(88);
    expect(dto.updatedAt).toBe("2026-09-22T09:00:00.000Z");
  });
});

describe("toTrendStatsDTO", () => {
  it("serializes the KPI aggregates", () => {
    const dto = toTrendStatsDTO({
      totalSnapshots: 30,
      maxScore: 95,
      keywordCount: 30,
      categoryCount: 5,
      lastCollectedAt: new Date("2026-09-22T12:00:00.000Z"),
    });
    expect(dto).toEqual({
      totalSnapshots: 30,
      maxScore: 95,
      keywordCount: 30,
      categoryCount: 5,
      lastCollectedAt: "2026-09-22T12:00:00.000Z",
    });
  });

  it("keeps null as null for an empty workspace", () => {
    const dto = toTrendStatsDTO({
      totalSnapshots: 0,
      maxScore: null,
      keywordCount: 0,
      categoryCount: 0,
      lastCollectedAt: null,
    });
    expect(dto.maxScore).toBeNull();
    expect(dto.lastCollectedAt).toBeNull();
  });
});
