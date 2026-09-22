import { describe, expect, it } from "vitest";
import { CreatorSource, CreatorStatus, type CreatorProfile } from "@prisma/client";
import {
  deriveDailyMetric,
  toCreateCreatorDTO,
  toCreatorListItemDTO,
  toCreatorPageDTO,
  toCreatorPipelineDTO,
  toCreatorStatsDTO,
  toDiscoveryUpsertDTO,
} from "@/modules/creators/crm/dto/creator.dto";
import type { ScoredCreator } from "@/modules/creators/interfaces/creator.interface";

/**
 * PR003 — DTO mappers.
 *
 * DTOs are the RSC serialization boundary: dates MUST become ISO strings
 * and every table/Kanban column must survive the mapping.
 */

const NOW = new Date("2026-09-22T12:00:00.000Z");

function fakeProfile(overrides: Partial<CreatorProfile> = {}): CreatorProfile {
  return {
    id: "creator_1",
    handle: "@ana.souza",
    displayName: "Ana Souza",
    avatarUrl: null,
    bio: null,
    email: null,
    followers: 250_000,
    avgViews: 90_000,
    engagementRate: 7.5,
    niche: "Moda",
    creatorScore: 64,
    status: CreatorStatus.NEW,
    source: CreatorSource.MOCK,
    externalId: "mock-moda-001",
    organizationId: "org_1",
    createdAt: NOW,
    updatedAt: NOW,
  } as CreatorProfile;
}

function fakeScored(overrides: Partial<ScoredCreator> = {}): ScoredCreator {
  return {
    externalId: "mock-moda-001",
    handle: "@ana.souza",
    displayName: "Ana Souza",
    niche: "Moda",
    followers: 250_000,
    avgViews: 90_000,
    engagementRate: 7.5,
    postsPerWeek: 4,
    growthRate: 10,
    qualityScore: 80,
    tags: ["moda masculina"],
    creatorScore: 64,
    ...overrides,
  };
}

describe("toCreatorListItemDTO", () => {
  it("serializes dates as ISO strings", () => {
    const dto = toCreatorListItemDTO(fakeProfile());
    expect(dto.createdAt).toBe(NOW.toISOString());
    expect(dto.updatedAt).toBe(NOW.toISOString());
  });

  it("keeps every table/Kanban column", () => {
    const dto = toCreatorListItemDTO(fakeProfile());
    expect(dto).toEqual({
      id: "creator_1",
      handle: "@ana.souza",
      displayName: "Ana Souza",
      avatarUrl: null,
      niche: "Moda",
      followers: 250_000,
      avgViews: 90_000,
      engagementRate: 7.5,
      creatorScore: 64,
      status: CreatorStatus.NEW,
      source: CreatorSource.MOCK,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("normalizes a missing avatar to null (never undefined)", () => {
    const dto = toCreatorListItemDTO(fakeProfile({ avatarUrl: undefined }));
    expect(dto.avatarUrl).toBeNull();
  });
});

describe("toCreatorPageDTO", () => {
  it("maps items and computes totalPages", () => {
    const page = toCreatorPageDTO([fakeProfile(), fakeProfile({ id: "creator_2" })], 2, 10, 25);
    expect(page.items).toHaveLength(2);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(10);
    expect(page.total).toBe(25);
    expect(page.totalPages).toBe(3);
  });

  it("never reports zero pages (empty base still shows 1 page)", () => {
    const page = toCreatorPageDTO([], 1, 10, 0);
    expect(page.totalPages).toBe(1);
  });
});

describe("toCreatorStatsDTO", () => {
  it("passes the KPI aggregates through untouched", () => {
    const stats = toCreatorStatsDTO({
      totalCreators: 100,
      averageScore: 58,
      premiumCount: 12,
      contactedCount: 35,
      statusCounts: {
        NEW: 40,
        QUALIFIED: 20,
        CONTACTED: 15,
        NEGOTIATING: 10,
        ACTIVE: 10,
        ARCHIVED: 5,
      },
    });
    expect(stats.totalCreators).toBe(100);
    expect(stats.averageScore).toBe(58);
    expect(stats.premiumCount).toBe(12);
    expect(stats.contactedCount).toBe(35);
    expect(stats.statusCounts.NEW).toBe(40);
  });
});

describe("toCreatorPipelineDTO", () => {
  it("groups columns with labels, totals and serialized cards", () => {
    const columns = toCreatorPipelineDTO([
      { status: "NEW", count: 2, items: [fakeProfile()] },
      { status: "QUALIFIED", count: 0, items: [] },
    ]);
    expect(columns).toHaveLength(2);
    expect(columns[0]!.status).toBe("NEW");
    expect(columns[0]!.label).toBe("Novo");
    expect(columns[0]!.count).toBe(2);
    expect(columns[0]!.items[0]!.createdAt).toBe(NOW.toISOString());
    expect(columns[1]!.label).toBe("Qualificado");
    expect(columns[1]!.items).toEqual([]);
  });
});

describe("toCreateCreatorDTO (manual CRM creation)", () => {
  it("stamps source MANUAL and status NEW", () => {
    const dto = toCreateCreatorDTO(
      {
        handle: "@novo.creator",
        displayName: "Novo Creator",
        niche: "Street",
        followers: 1000,
        avgViews: 500,
        engagementRate: 4,
      },
      22,
    );
    expect(dto.source).toBe(CreatorSource.MANUAL);
    expect(dto.status).toBe(CreatorStatus.NEW);
    expect(dto.creatorScore).toBe(22);
  });

  it("applies zero defaults for omitted metrics", () => {
    const dto = toCreateCreatorDTO(
      { handle: "@novo.creator", displayName: "Novo Creator", niche: "Moda" },
      0,
    );
    expect(dto.followers).toBe(0);
    expect(dto.avgViews).toBe(0);
    expect(dto.engagementRate).toBe(0);
  });
});

describe("toDiscoveryUpsertDTO (discovery ingestion)", () => {
  it("stamps the collector's source and keeps the score", () => {
    const dto = toDiscoveryUpsertDTO(fakeScored(), CreatorSource.MOCK);
    expect(dto.source).toBe(CreatorSource.MOCK);
    expect(dto.externalId).toBe("mock-moda-001");
    expect(dto.creatorScore).toBe(64);
    expect(dto.status).toBe(CreatorStatus.NEW);
  });

  it("carries every persisted metric", () => {
    const dto = toDiscoveryUpsertDTO(fakeScored(), CreatorSource.TIKTOK);
    expect(dto).toMatchObject({
      handle: "@ana.souza",
      displayName: "Ana Souza",
      niche: "Moda",
      followers: 250_000,
      avgViews: 90_000,
      engagementRate: 7.5,
    });
  });
});

describe("deriveDailyMetric (metric snapshot)", () => {
  it("derives likes from the engagement rate and shares from likes", () => {
    const date = new Date("2026-09-22T00:00:00.000Z");
    const metric = deriveDailyMetric(fakeScored({ avgViews: 10_000, engagementRate: 10 }), date);
    // likes = 10_000 * 10% = 1_000 · shares = 10% of likes = 100
    expect(metric).toEqual({
      date,
      views: 10_000,
      likes: 1_000,
      shares: 100,
      followers: 250_000,
    });
  });
});
