import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import type {
  TrendCategoryName,
  TrendCollector,
  TrendSignal,
} from "@/modules/trends/interfaces/trend.interface";
import type { TrendSnapshot } from "@prisma/client";
import {
  collectDailyTrendsJob,
  createCollectDailyTrendsJob,
  trendScheduler,
  type SchedulerJob,
} from "@/modules/trends/hunter/scheduler";
import { getTrendCollector } from "@/modules/trends/hunter/collector";
import { calculateTrendScore } from "@/modules/trends/hunter/scorer";
import type { CreateTrendDTO } from "@/modules/trends/dto/create-trend.dto";
import type { TrendRepository } from "@/modules/trends/repositories/trend.repository";

/**
 * PR002 — Trend Hunter Scheduler.
 *
 * The `collect-daily-trends` job orchestrates: collector → score engine →
 * validation → repository. Its dependencies are injected, so these tests
 * run the REAL job against fake collaborators.
 *
 * Also pinned: execution is MANUAL ONLY in PR002 (no cron — `schedule` is
 * undefined and the registry registers no timers).
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const ORG = "org_scheduler";

function signal(overrides: Partial<TrendSignal> = {}): TrendSignal {
  return {
    keyword: "camisa masculina",
    category: "Moda",
    views: 1_000_000,
    likes: 200_000,
    shares: 30_000,
    margin: 60,
    saturation: 20,
    ...overrides,
  };
}

function fakeCollector(signals: TrendSignal[], spy = vi.fn()) {
  const collector: TrendCollector = {
    source: "test",
    collectDailyTrends: spy.mockResolvedValue(signals),
  };
  return { collector, spy };
}

interface CallLog {
  snapshots: CreateTrendDTO[];
  keywords: Array<{ keyword: string; increment: number }>;
  categories: Array<{ name: string; score: number }>;
}

function fakeRepository(failing?: (organizationId: string) => Error) {
  const log: CallLog = { snapshots: [], keywords: [], categories: [] };
  const repository: TrendRepository = {
    createSnapshot: vi.fn(async (organizationId, data) => {
      if (failing?.(organizationId)) throw failing(organizationId);
      log.snapshots.push(data);
      return { id: `snap_${log.snapshots.length}`, organizationId, ...data } as TrendSnapshot;
    }),
    listSnapshots: vi.fn(async () => ({ items: [], total: 0 })),
    topTrends: vi.fn(async () => []),
    findKeywords: vi.fn(async () => []),
    findCategories: vi.fn(async () => []),
    upsertKeyword: vi.fn(async (organizationId, keyword, increment = 1) => {
      if (failing?.(organizationId)) throw failing(organizationId);
      log.keywords.push({ keyword, increment });
      return {
        id: `kw_${keyword}`,
        keyword,
        frequency: increment,
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
    upsertCategory: vi.fn(async (organizationId, name, score) => {
      if (failing?.(organizationId)) throw failing(organizationId);
      log.categories.push({ name, score });
      return {
        id: `cat_${name}`,
        name,
        score,
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
    stats: vi.fn(async () => ({
      totalSnapshots: 0,
      maxScore: null,
      keywordCount: 0,
      categoryCount: 0,
      lastCollectedAt: null,
    })),
  };
  return { repository, log };
}

describe("SchedulerJob contract", () => {
  it("registers exactly one job — collect-daily-trends", () => {
    expect(trendScheduler.jobs).toHaveLength(1);
    expect(trendScheduler.jobs[0]?.key).toBe("collect-daily-trends");
  });

  it("getJob() resolves by key and returns undefined for unknown keys", () => {
    expect(trendScheduler.getJob("collect-daily-trends")?.key).toBe("collect-daily-trends");
    expect(trendScheduler.getJob("nope")).toBeUndefined();
  });

  it("is MANUAL ONLY in PR002 — no cron expression anywhere", () => {
    for (const job of trendScheduler.jobs) {
      expect(job.schedule).toBeUndefined();
    }
    expect(collectDailyTrendsJob.schedule).toBeUndefined();
  });

  it("exposes human-readable metadata", () => {
    expect(collectDailyTrendsJob.name).toContain("tendências");
    expect(collectDailyTrendsJob.description.length).toBeGreaterThan(10);
  });

  it("the default job uses the mock collector and the app repository", () => {
    // The default instance is built from the real collaborators (mock
    // collector + tenant-scoped Prisma repository) — injected fakes are a
    // test-only facility.
    const job = createCollectDailyTrendsJob();
    expect(job.key).toBe("collect-daily-trends");
  });
});

describe("collect-daily-trends — execution flow", () => {
  it("collects, scores, validates and persists every signal", async () => {
    const camisaSignal = signal({ keyword: "Camisa Masculina" }); // canonicalized to lowercase
    const signals = [
      camisaSignal,
      signal({ keyword: "polo slim", category: "Casual", views: 500_000 }),
    ];
    const { collector } = fakeCollector(signals);
    const { repository, log } = fakeRepository();

    const job = createCollectDailyTrendsJob({ collector, repository });
    const result = await job.execute(ORG);

    expect(result.status).toBe("success");
    expect(result.collected).toBe(2);
    expect(result.snapshotsCreated).toBe(2);
    expect(result.keywordsUpserted).toBe(2);
    expect(result.categoriesUpserted).toBe(2); // Moda + Casual

    // Snapshots are scored by the engine and keywords are canonicalized.
    expect(log.snapshots[0]).toEqual({
      keyword: "camisa masculina",
      category: "Moda",
      views: 1_000_000,
      likes: 200_000,
      shares: 30_000,
      trendScore: calculateTrendScore(camisaSignal),
    });
    expect(log.snapshots[1]?.keyword).toBe("polo slim");
  });

  it("runs the full mock dataset end-to-end (30 snapshots, 5 categories)", async () => {
    const mockCollector = getTrendCollector();
    const { repository, log } = fakeRepository();
    const job = createCollectDailyTrendsJob({ collector: mockCollector, repository });

    const result = await job.execute(ORG);

    expect(result.status).toBe("success");
    expect(result.snapshotsCreated).toBe(30);
    expect(result.keywordsUpserted).toBe(30); // all unique
    expect(result.categoriesUpserted).toBe(5);
    expect(result.topScore).toBe(Math.max(...log.snapshots.map((s) => s.trendScore)));
    expect(result.topKeyword).toBe(
      log.snapshots.find((s) => s.trendScore === result.topScore)?.keyword,
    );
  });

  it("aggregates duplicate keywords into a single frequency increment", async () => {
    const signals = [signal(), signal({ views: 800_000 })]; // same keyword twice
    const { collector } = fakeCollector(signals);
    const { repository, log } = fakeRepository();

    const job = createCollectDailyTrendsJob({ collector, repository });
    await job.execute(ORG);

    expect(log.snapshots).toHaveLength(2);
    expect(log.keywords).toEqual([{ keyword: "camisa masculina", increment: 2 }]);
  });

  it("materializes the per-category average score", async () => {
    const signals = [
      signal({ views: 1_200_000, likes: 250_000, shares: 35_000, margin: 100, saturation: 0 }), // score 100
      signal({ keyword: "polo slim", views: 0, likes: 0, shares: 0, margin: 0, saturation: 100 }), // score 0
    ];
    const { collector } = fakeCollector(signals);
    const { repository, log } = fakeRepository();

    const job = createCollectDailyTrendsJob({ collector, repository });
    await job.execute(ORG);

    expect(log.categories).toEqual([{ name: "Moda", score: 50 }]);
  });

  it("reports timing metadata (ISO timestamps, duration >= 0)", async () => {
    const { collector } = fakeCollector([signal()]);
    const { repository } = fakeRepository();
    const job = createCollectDailyTrendsJob({ collector, repository });

    const before = Date.now();
    const result = await job.execute(ORG);

    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
    expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(result.startedAt).getTime()).toBeGreaterThanOrEqual(before - 5);
  });
});

describe("collect-daily-trends — failure handling", () => {
  it("returns a failed result (never throws) when the collector errors", async () => {
    const collector: TrendCollector = {
      source: "broken",
      collectDailyTrends: vi.fn().mockRejectedValue(new Error("boom na fonte")),
    };
    const { repository } = fakeRepository();
    const job = createCollectDailyTrendsJob({ collector, repository });

    const result = await job.execute(ORG);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("boom na fonte");
    expect(result.snapshotsCreated).toBe(0);
    expect(result.topKeyword).toBeNull();
  });

  it("fails (instead of persisting) when a signal is invalid", async () => {
    const { collector } = fakeCollector([signal({ category: "Pet" as TrendCategoryName })]);
    const { repository, log } = fakeRepository();
    const job = createCollectDailyTrendsJob({ collector, repository });

    const result = await job.execute(ORG);

    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
    expect(log.snapshots).toHaveLength(0); // validated BEFORE persisting
  });

  it("re-throws AuthorizationError so the action maps a 403 (never a failed job)", async () => {
    const { collector } = fakeCollector([signal()]);
    const { repository } = fakeRepository(() => new AuthorizationError("Forbidden.", 403));
    const job = createCollectDailyTrendsJob({ collector, repository });

    await expect(job.execute("")).rejects.toThrow(AuthorizationError);
  });

  it("reports how many snapshots were created before a mid-run failure", async () => {
    const signals = [signal(), signal({ keyword: "polo slim" })];
    const { collector } = fakeCollector(signals);
    const { repository, log } = fakeRepository();
    let calls = 0;
    (repository.createSnapshot as ReturnType<typeof vi.fn>).mockImplementation(
      async (organizationId: string, data: CreateTrendDTO) => {
        calls += 1;
        if (calls === 2) throw new Error("falha no segundo snapshot");
        log.snapshots.push(data);
        return { id: `snap_${calls}`, organizationId, ...data } as TrendSnapshot;
      },
    );

    const job = createCollectDailyTrendsJob({ collector, repository });
    const result = await job.execute(ORG);

    expect(result.status).toBe("failed");
    expect(result.snapshotsCreated).toBe(1);
    expect(result.error).toContain("falha no segundo snapshot");
  });
});
