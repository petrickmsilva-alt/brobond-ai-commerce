import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorPlatform } from "@prisma/client";
import type { ConnectorState } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import {
  connectorScheduler,
  connectorSyncJob,
  createConnectorSyncJob,
} from "@/modules/connectors/core/connector.sync";
import type { Connector, NormalizedContent } from "@/modules/connectors/core/connector.interface";
import { ConnectorNotImplementedError } from "@/modules/connectors/core/connector.interface";
import type { ConnectorRepository } from "@/modules/connectors/core/connector.repository";
import { MockConnector } from "@/modules/connectors/mock/mock.connector";

/**
 * PR005 — the `sync-connector` job.
 *
 * Connector and repository are injected, so the orchestration is tested
 * end-to-end without a database: fetch → validate (Zod) → dedupe → persist
 * as IMPORTED / DUPLICATE / FAILED → update the connector state and
 * counters.
 *
 * MANUAL EXECUTION ONLY: no cron exists anywhere — `schedule` stays
 * undefined by design.
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const ORG = "org_sync";

function content(overrides: Partial<NormalizedContent> = {}): NormalizedContent {
  return {
    externalId: "mock-video-001",
    type: "VIDEO",
    title: "Camisa masculina — vídeo 001",
    url: "https://mock.brobond.local/video/001",
    views: 1000,
    likes: 100,
    shares: 10,
    publishedAt: new Date(Date.UTC(2026, 8, 1)),
    ...overrides,
  };
}

function fakeConnector(
  items: NormalizedContent[],
  platform: ConnectorPlatform = ConnectorPlatform.MOCK,
): Connector {
  return {
    platform,
    name: "Fake Connector",
    implemented: true,
    fetchContent: vi.fn(async () => items),
    testConnection: vi.fn(async () => ({
      platform,
      ok: true,
      implemented: true,
      message: "ok",
    })),
  };
}

/** In-memory repository capturing exactly what the job persisted. */
function fakeRepository(overrides: Partial<ConnectorRepository> = {}) {
  const rows: {
    id: string;
    externalId: string;
    platform: string;
    status: string;
    views: number;
  }[] = [];
  const recorded: {
    state: ConnectorState;
    counters: { imported: number; duplicates: number; failed: number };
    lastError?: string | null;
  }[] = [];

  const repository = {
    listStatuses: vi.fn(async () => []),
    findStatus: vi.fn(async () => null),
    ensureStatus: vi.fn(async (_org: string, platform: ConnectorPlatform) => ({
      id: `status_${platform}`,
      platform,
    })),
    setEnabled: vi.fn(),
    recordSyncResult: vi.fn(async (_org: string, _platform: ConnectorPlatform, result) => {
      recorded.push(result);
      return {};
    }),
    createContent: vi.fn(async (_org: string, data) => {
      const row = {
        id: `content_${rows.length + 1}`,
        externalId: data.externalId,
        platform: data.platform,
        status: data.status,
        views: data.views,
      };
      rows.push(row);
      return row;
    }),
    findContentByExternalId: vi.fn(
      async (_org: string, platform, externalId) =>
        rows.find(
          (row) =>
            row.platform === platform && row.externalId === externalId && row.status === "IMPORTED",
        ) ?? null,
    ),
    refreshContent: vi.fn(async (_org: string, id: string, data) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) row.views = data.views;
      return row ?? null;
    }),
    listContent: vi.fn(),
    kpis: vi.fn(),
    ...overrides,
  } as unknown as ConnectorRepository;

  return { repository, rows, recorded };
}

// ------------------------------------------------------------------

describe("sync-connector job — descriptor", () => {
  it("declares a stable key and a pt-BR name", () => {
    expect(connectorSyncJob.key).toBe("sync-connector");
    expect(connectorSyncJob.name.length).toBeGreaterThan(0);
    expect(connectorSyncJob.description.length).toBeGreaterThan(0);
  });

  it("registers NO cron — manual execution only (PR005 contract)", () => {
    expect(connectorSyncJob.schedule).toBeUndefined();
    for (const job of connectorScheduler.jobs) {
      expect(job.schedule).toBeUndefined();
    }
  });

  it("is exposed through the scheduler registry", () => {
    expect(connectorScheduler.getJob("sync-connector")).toBe(connectorSyncJob);
    expect(connectorScheduler.getJob("nope")).toBeUndefined();
    expect(connectorScheduler.defaultPlatform).toBe(ConnectorPlatform.MOCK);
  });
});

describe("sync-connector job — success flow", () => {
  it("imports every new item and reports the counters", async () => {
    const { repository, rows, recorded } = fakeRepository();
    const job = createConnectorSyncJob({
      resolve: () => fakeConnector([content({ externalId: "a" }), content({ externalId: "b" })]),
      repository,
    });

    const result = await job.run(ORG, ConnectorPlatform.MOCK);

    expect(result.status).toBe("success");
    expect(result.fetched).toBe(2);
    expect(result.imported).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.state).toBe("ACTIVE");
    expect(rows.every((row) => row.status === "IMPORTED")).toBe(true);
    expect(recorded[0]).toMatchObject({
      state: "ACTIVE",
      counters: { imported: 2, duplicates: 0, failed: 0 },
    });
  });

  it("passes the tenant as the first argument of every repository call", async () => {
    const { repository } = fakeRepository();
    const job = createConnectorSyncJob({
      resolve: () => fakeConnector([content()]),
      repository,
    });

    await job.run(ORG, ConnectorPlatform.MOCK);

    expect(repository.ensureStatus).toHaveBeenCalledWith(ORG, ConnectorPlatform.MOCK);
    expect(repository.createContent).toHaveBeenCalledWith(ORG, expect.anything());
    expect(repository.findContentByExternalId).toHaveBeenCalledWith(
      ORG,
      ConnectorPlatform.MOCK,
      "mock-video-001",
    );
  });

  it("stamps every persisted row with the connector's platform", async () => {
    const { repository, rows } = fakeRepository();
    const job = createConnectorSyncJob({
      resolve: () => fakeConnector([content()], ConnectorPlatform.INSTAGRAM),
      repository,
    });

    await job.run(ORG, ConnectorPlatform.INSTAGRAM);

    expect(rows[0]?.platform).toBe(ConnectorPlatform.INSTAGRAM);
  });

  it("reports timing metadata on every run", async () => {
    const { repository } = fakeRepository();
    const job = createConnectorSyncJob({ resolve: () => fakeConnector([]), repository });

    const result = await job.run(ORG, ConnectorPlatform.MOCK);

    expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(
      new Date(result.finishedAt).getTime(),
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.job).toBe("sync-connector");
    expect(result.platform).toBe(ConnectorPlatform.MOCK);
  });

  it("an empty fetch is a success with zeroed counters (not a failure)", async () => {
    const { repository } = fakeRepository();
    const job = createConnectorSyncJob({ resolve: () => fakeConnector([]), repository });

    const result = await job.run(ORG, ConnectorPlatform.MOCK);

    expect(result).toMatchObject({
      status: "success",
      fetched: 0,
      imported: 0,
      duplicates: 0,
      failed: 0,
      state: "ACTIVE",
    });
  });
});

describe("sync-connector job — dedupe (the 'Duplicados' KPI)", () => {
  it("counts a repeated externalId as DUPLICATE, not as a second import", async () => {
    const { repository, rows } = fakeRepository();
    const job = createConnectorSyncJob({
      resolve: () =>
        fakeConnector([
          content({ externalId: "dup", views: 100 }),
          content({ externalId: "dup", views: 500 }),
        ]),
      repository,
    });

    const result = await job.run(ORG, ConnectorPlatform.MOCK);

    expect(result.imported).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(rows).toHaveLength(1); // no second row was created
  });

  it("refreshes the known row's engagement numbers on a duplicate", async () => {
    const { repository, rows } = fakeRepository();
    const job = createConnectorSyncJob({
      resolve: () =>
        fakeConnector([
          content({ externalId: "dup", views: 100 }),
          content({ externalId: "dup", views: 900 }),
        ]),
      repository,
    });

    await job.run(ORG, ConnectorPlatform.MOCK);

    expect(repository.refreshContent).toHaveBeenCalledTimes(1);
    expect(rows[0]?.views).toBe(900);
  });

  it("a second run over the same dataset imports nothing and duplicates everything", async () => {
    const { repository } = fakeRepository();
    const items = [content({ externalId: "a" }), content({ externalId: "b" })];
    const job = createConnectorSyncJob({ resolve: () => fakeConnector(items), repository });

    const first = await job.run(ORG, ConnectorPlatform.MOCK);
    const second = await job.run(ORG, ConnectorPlatform.MOCK);

    expect(first).toMatchObject({ imported: 2, duplicates: 0 });
    expect(second).toMatchObject({ imported: 0, duplicates: 2 });
  });

  it("the real mock dataset produces duplicates end-to-end", async () => {
    const { repository } = fakeRepository();
    const job = createConnectorSyncJob({
      resolve: () => new MockConnector(),
      repository,
      limit: 1000,
    });

    const result = await job.run(ORG, ConnectorPlatform.MOCK);

    expect(result.status).toBe("success");
    expect(result.imported).toBeGreaterThan(0);
    expect(result.duplicates).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(result.imported + result.duplicates).toBe(result.fetched);
  });
});

describe("sync-connector job — failures (the 'Falhas' KPI)", () => {
  it("records an invalid item as FAILED instead of crashing the run", async () => {
    const { repository, rows } = fakeRepository();
    const job = createConnectorSyncJob({
      resolve: () =>
        fakeConnector([
          content({ externalId: "good" }),
          // Empty title + negative views → rejected by the schema.
          content({ externalId: "bad", title: "", views: -5 }),
        ]),
      repository,
    });

    const result = await job.run(ORG, ConnectorPlatform.MOCK);

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.status).toBe("success"); // partial success is still a run
    expect(rows.find((row) => row.status === "FAILED")).toBeDefined();
  });

  it("persists the validation reason on the FAILED row", async () => {
    const { repository } = fakeRepository();
    const job = createConnectorSyncJob({
      resolve: () => fakeConnector([content({ title: "" })]),
      repository,
    });

    await job.run(ORG, ConnectorPlatform.MOCK);

    expect(repository.createContent).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ status: "FAILED", errorReason: expect.any(String) }),
    );
  });

  it("a persistence error becomes a FAILED row, not an exception", async () => {
    const base = fakeRepository();
    let firstCall = true;
    const repository = {
      ...base.repository,
      createContent: vi.fn(async (_org: string, data) => {
        if (firstCall && data.status === "IMPORTED") {
          firstCall = false;
          throw new Error("database exploded");
        }
        return { id: "row", ...data };
      }),
    } as unknown as ConnectorRepository;

    const job = createConnectorSyncJob({
      resolve: () => fakeConnector([content()]),
      repository,
    });

    const result = await job.run(ORG, ConnectorPlatform.MOCK);

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.state).toBe("ERROR");
  });

  it("marks the connector ERROR only when NOTHING succeeded", async () => {
    const { repository } = fakeRepository();
    const partial = createConnectorSyncJob({
      resolve: () => fakeConnector([content({ externalId: "ok" }), content({ title: "" })]),
      repository,
    });

    const result = await partial.run(ORG, ConnectorPlatform.MOCK);

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.state).toBe("ACTIVE"); // partial success keeps it usable
  });
});

describe("sync-connector job — placeholder platforms", () => {
  const placeholders = [
    ConnectorPlatform.TIKTOK,
    ConnectorPlatform.INSTAGRAM,
    ConnectorPlatform.SHOPEE,
  ];

  it("records a placeholder sync as ERROR without throwing", async () => {
    for (const platform of placeholders) {
      const { repository, recorded } = fakeRepository();
      const job = createConnectorSyncJob({
        resolve: () => ({
          platform,
          name: `${platform} Connector`,
          implemented: false,
          fetchContent: async () => {
            throw new ConnectorNotImplementedError(platform);
          },
          testConnection: async () => ({
            platform,
            ok: false,
            implemented: false,
            message: "placeholder",
          }),
        }),
        repository,
      });

      const result = await job.run(ORG, platform);

      expect(result.status).toBe("failed");
      expect(result.state).toBe("ERROR");
      expect(result.imported).toBe(0);
      expect(result.error).toMatch(/não foi implementado/i);
      expect(recorded[0]?.state).toBe("ERROR");
      expect(recorded[0]?.lastError).toMatch(/não foi implementado/i);
    }
  });

  it("uses the REAL factory placeholders end-to-end (no injection)", async () => {
    const { repository } = fakeRepository();
    const job = createConnectorSyncJob({ repository });

    const result = await job.run(ORG, ConnectorPlatform.SHOPEE);

    expect(result.status).toBe("failed");
    expect(result.state).toBe("ERROR");
  });

  it("a placeholder failure never creates content rows", async () => {
    const { repository, rows } = fakeRepository();
    const job = createConnectorSyncJob({ repository });

    await job.run(ORG, ConnectorPlatform.TIKTOK);

    expect(rows).toHaveLength(0);
  });
});

describe("sync-connector job — error handling", () => {
  let repository: ConnectorRepository;

  beforeEach(() => {
    repository = fakeRepository().repository;
  });

  it("re-throws AuthorizationError (401/403 must not become a 'failed job')", async () => {
    const job = createConnectorSyncJob({
      resolve: () => {
        throw new AuthorizationError("Forbidden", 403);
      },
      repository,
    });

    await expect(job.run(ORG, ConnectorPlatform.MOCK)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("an unregistered platform is reported, not thrown", async () => {
    const job = createConnectorSyncJob({ repository });

    const result = await job.run(ORG, "YOUTUBE" as ConnectorPlatform);

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/No Connector is registered/);
  });

  it("a non-placeholder fetch failure is recorded with its message", async () => {
    const { repository: repo, recorded } = fakeRepository();
    const job = createConnectorSyncJob({
      resolve: () => ({
        platform: ConnectorPlatform.MOCK,
        name: "Flaky",
        implemented: true,
        fetchContent: async () => {
          throw new Error("timeout");
        },
        testConnection: async () => ({
          platform: ConnectorPlatform.MOCK,
          ok: false,
          implemented: true,
          message: "down",
        }),
      }),
      repository: repo,
    });

    const result = await job.run(ORG, ConnectorPlatform.MOCK);

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/timeout/);
    expect(recorded[0]?.state).toBe("ERROR");
  });
});
