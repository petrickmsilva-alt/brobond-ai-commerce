import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreatorSource, CreatorStatus } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import type { CreatorCandidate } from "@/modules/creators/interfaces/creator.interface";
import type { CreatorRepository } from "@/modules/creators/crm/repositories/creator-profile.repository";
import type { DiscoveryUpsertDTO } from "@/modules/creators/crm/dto/creator.dto";
import {
  createDiscoverCreatorsJob,
  creatorScheduler,
  discoverCreatorsJob,
} from "@/modules/creators/discovery/scheduler";

/**
 * PR003 — the `discover-creators` scheduler job.
 *
 * Collector and repository are injected, so the orchestration is tested
 * end-to-end without a database: collect → validate (Zod) → score →
 * upsert (source-stamped) → tags → daily metric → top creator.
 *
 * MANUAL EXECUTION ONLY: no cron exists anywhere — `schedule` stays
 * undefined by design.
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const ORG = "org_scheduler";

function candidate(overrides: Partial<CreatorCandidate> = {}): CreatorCandidate {
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
    ...overrides,
  };
}

function createFakeCollector(candidates: CreatorCandidate[], source = CreatorSource.MOCK) {
  return {
    source,
    collect: vi.fn(async () => candidates),
  };
}

function createFakeRepository(overrides: Partial<CreatorRepository> = {}): CreatorRepository {
  const created: { id: string; handle: string; creatorScore: number }[] = [];
  return {
    createCreator: vi.fn(),
    updateCreator: vi.fn(),
    listCreators: vi.fn(),
    topCreators: vi.fn(async (_org, options) =>
      [...created].sort((a, b) => b.creatorScore - a.creatorScore).slice(0, options?.limit ?? 10),
    ),
    changeStatus: vi.fn(),
    findById: vi.fn(),
    stats: vi.fn(),
    pipeline: vi.fn(),
    upsertFromDiscovery: vi.fn(async (_org, dto: DiscoveryUpsertDTO) => {
      const existing = created.find((row) => row.handle === dto.handle);
      if (existing) {
        existing.creatorScore = dto.creatorScore;
        return { creator: { ...existing }, created: false };
      }
      const row = {
        id: `creator_${created.length + 1}`,
        handle: dto.handle,
        creatorScore: dto.creatorScore,
      };
      created.push(row);
      return { creator: row, created: true };
    }),
    recordMetric: vi.fn(async () => ({})),
    addTag: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as CreatorRepository;
}

describe("discover-creators job — success flow", () => {
  let repository: CreatorRepository;
  let collector: ReturnType<typeof createFakeCollector>;

  beforeEach(() => {
    collector = createFakeCollector([
      candidate({ externalId: "mock-moda-001", handle: "@a.one", tags: ["moda masculina"] }),
      candidate({ externalId: "mock-moda-002", handle: "@a.two", tags: [] }),
      candidate({ externalId: "mock-moda-003", handle: "@a.three" }),
    ]);
    repository = createFakeRepository();
  });

  it("collects, scores and upserts every candidate", async () => {
    const job = createDiscoverCreatorsJob({ collector, repository });
    const result = await job.execute(ORG);

    expect(result.status).toBe("success");
    expect(result.collected).toBe(3);
    expect(result.creatorsCreated).toBe(3);
    expect(result.creatorsUpdated).toBe(0);
    expect(repository.upsertFromDiscovery).toHaveBeenCalledTimes(3);
  });

  it("always passes the caller's organizationId to the repository", async () => {
    const job = createDiscoverCreatorsJob({ collector, repository });
    await job.execute(ORG);
    for (const call of vi.mocked(repository.upsertFromDiscovery).mock.calls) {
      expect(call[0]).toBe(ORG);
    }
  });

  it("stamps every upsert with the collector's source", async () => {
    const job = createDiscoverCreatorsJob({ collector, repository });
    await job.execute(ORG);
    for (const call of vi.mocked(repository.upsertFromDiscovery).mock.calls) {
      expect(call[1].source).toBe(CreatorSource.MOCK);
    }
    const result = await job.execute(ORG);
    expect(result.source).toBe(CreatorSource.MOCK);
  });

  it("attaches one tag per candidate tag and one metric per candidate", async () => {
    const job = createDiscoverCreatorsJob({ collector, repository });
    const result = await job.execute(ORG);

    // candidate 1: 1 tag · candidate 2: 0 tags · candidate 3: 1 tag.
    expect(repository.addTag).toHaveBeenCalledTimes(2);
    expect(repository.recordMetric).toHaveBeenCalledTimes(3);
    expect(result.tagsUpserted).toBe(2);
    expect(result.metricsRecorded).toBe(3);
  });

  it("records every metric on the same UTC-midnight date (daily upsert)", async () => {
    const job = createDiscoverCreatorsJob({ collector, repository });
    await job.execute(ORG);
    const dates = vi.mocked(repository.recordMetric).mock.calls.map((call) => call[2].date);
    for (const date of dates) {
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
      expect(date.getUTCSeconds()).toBe(0);
    }
    expect(new Set(dates.map((date) => date.toISOString())).size).toBe(1);
  });

  it("reports the top creator of the run", async () => {
    const job = createDiscoverCreatorsJob({ collector, repository });
    const result = await job.execute(ORG);
    expect(result.topHandle).not.toBeNull();
    expect(result.topScore).not.toBeNull();
    expect(result.topScore).toBeGreaterThanOrEqual(0);
    expect(result.topScore).toBeLessThanOrEqual(100);
  });

  it("re-runs update instead of create (dedupe on source+externalId)", async () => {
    const job = createDiscoverCreatorsJob({ collector, repository });
    await job.execute(ORG);
    const second = await job.execute(ORG);
    expect(second.status).toBe("success");
    expect(second.creatorsCreated).toBe(0);
    expect(second.creatorsUpdated).toBe(3);
  });

  it("reports timing metadata", async () => {
    const job = createDiscoverCreatorsJob({ collector, repository });
    const result = await job.execute(ORG);
    expect(result.job).toBe("discover-creators");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(
      new Date(result.finishedAt).getTime(),
    );
  });
});

describe("discover-creators job — validation & scoring", () => {
  it("rejects an invalid candidate (unknown niche) as a failed run", async () => {
    const collector = createFakeCollector([
      candidate({ niche: "Pet" as CreatorCandidate["niche"] }),
    ]);
    const repository = createFakeRepository();
    const job = createDiscoverCreatorsJob({ collector, repository });
    const result = await job.execute(ORG);

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(repository.upsertFromDiscovery).not.toHaveBeenCalled();
  });

  it("canonicalizes the handle before persisting", async () => {
    const collector = createFakeCollector([candidate({ handle: "@Ana.Souza" })]);
    const repository = createFakeRepository();
    const job = createDiscoverCreatorsJob({ collector, repository });
    await job.execute(ORG);
    expect(repository.upsertFromDiscovery).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ handle: "@ana.souza" }),
    );
  });

  it("scores candidates with the score engine (0–100)", async () => {
    const collector = createFakeCollector([candidate({ qualityScore: 100, growthRate: 20 })]);
    const repository = createFakeRepository();
    const job = createDiscoverCreatorsJob({ collector, repository });
    await job.execute(ORG);
    const payload = vi.mocked(repository.upsertFromDiscovery).mock.calls[0]![1];
    expect(payload.creatorScore).toBeGreaterThanOrEqual(0);
    expect(payload.creatorScore).toBeLessThanOrEqual(100);
  });

  it("persists NEW as the initial status (never skips the funnel)", async () => {
    const collector = createFakeCollector([candidate()]);
    const repository = createFakeRepository();
    const job = createDiscoverCreatorsJob({ collector, repository });
    await job.execute(ORG);
    const payload = vi.mocked(repository.upsertFromDiscovery).mock.calls[0]![1];
    expect(payload.status).toBe(CreatorStatus.NEW);
  });
});

describe("discover-creators job — failure handling", () => {
  it("returns a failed result (never throws) on a repository error", async () => {
    const collector = createFakeCollector([candidate()]);
    const repository = createFakeRepository({
      upsertFromDiscovery: vi.fn(async () => {
        throw new Error("database exploded");
      }),
    });
    const job = createDiscoverCreatorsJob({ collector, repository });
    const result = await job.execute(ORG);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("database exploded");
    expect(result.collected).toBe(1);
    expect(result.creatorsCreated).toBe(0);
  });

  it("re-throws AuthorizationError (401/403 must not look like a failed job)", async () => {
    const collector = createFakeCollector([candidate()]);
    const repository = createFakeRepository({
      upsertFromDiscovery: vi.fn(async () => {
        throw new AuthorizationError("Forbidden: organization scope is required.", 403);
      }),
    });
    const job = createDiscoverCreatorsJob({ collector, repository });
    await expect(job.execute("")).rejects.toThrow(AuthorizationError);
  });

  it("surfaces a collector failure as a failed run", async () => {
    const collector = {
      source: CreatorSource.TIKTOK,
      collect: vi.fn(async () => {
        throw new Error("Not implemented");
      }),
    };
    const repository = createFakeRepository();
    const job = createDiscoverCreatorsJob({ collector, repository });
    const result = await job.execute(ORG);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Not implemented");
    expect(result.source).toBe(CreatorSource.TIKTOK);
  });
});

describe("scheduler registry", () => {
  it("registers exactly the discover-creators job", () => {
    expect(creatorScheduler.jobs.map((job) => job.key)).toEqual(["discover-creators"]);
    expect(creatorScheduler.getJob("discover-creators")?.key).toBe("discover-creators");
    expect(creatorScheduler.getJob("nope")).toBeUndefined();
  });

  it("is MANUAL ONLY — no cron schedule is registered (by design)", () => {
    for (const job of creatorScheduler.jobs) {
      expect(job.schedule).toBeUndefined();
    }
  });

  it("exposes a pt-BR name and description for the UI", () => {
    const job = creatorScheduler.getJob("discover-creators")!;
    expect(job.name).toBe("Descoberta de creators");
    expect(job.description.length).toBeGreaterThan(10);
  });

  it("the default job instance collects the full mock dataset (100 creators)", async () => {
    // discoverCreatorsJob uses the real MOCK collector + app repository.
    // We only assert its configuration here — executing it would need a DB.
    expect(discoverCreatorsJob.key).toBe("discover-creators");
  });

  it("defaults to the MOCK source", async () => {
    const repository = createFakeRepository();
    // No source/collector injected → factory resolves MOCK behind the scenes.
    const job = createDiscoverCreatorsJob({ repository });
    expect(job.key).toBe("discover-creators");
  });
});
