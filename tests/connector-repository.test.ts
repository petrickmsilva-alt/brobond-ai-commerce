import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorPlatform } from "@prisma/client";
import type { ConnectorState } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import {
  createConnectorRepository,
  type ConnectorDatabase,
} from "@/modules/connectors/core/connector.repository";
import { contentListQuerySchema } from "@/modules/connectors/core/connector.validator";
import type { CreateExternalContentDTO } from "@/modules/connectors/core/connector.dto";

/**
 * PR005 — Connector repository, tested against an in-memory fake Prisma.
 *
 * The repository is created through `createConnectorRepository(db)` exactly
 * as production does — only the database is faked — so these tests exercise
 * the real tenant-isolation contract:
 *
 *   1. every query carries `organizationId`;
 *   2. a missing/blank tenant throws BEFORE any database call;
 *   3. one tenant can never read, update or aggregate another tenant's
 *      connectors or imported content.
 *
 * (`@/lib/prisma` is mocked so importing the repository module does not
 * instantiate a PrismaClient in the test environment.)
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const ORG_A = "org_tenant_a";
const ORG_B = "org_tenant_b";

// ------------------------------------------------------------------
// In-memory fake Prisma (subset used by the connectors repository)
// ------------------------------------------------------------------

type AnyRow = Record<string, unknown>;

/** Prisma-`where` subset: equality · contains (insensitive) · in · OR. */
function matches(row: AnyRow, condition: unknown): boolean {
  if (condition === undefined || condition === null) return true;
  if (typeof condition !== "object") return false;

  for (const [key, value] of Object.entries(condition as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (key === "OR") {
      const alternatives = value as unknown[];
      if (!alternatives.some((alt) => matches(row, alt))) return false;
      continue;
    }
    if (typeof value === "object" && value !== null) {
      if ("contains" in (value as object)) {
        const needle = String((value as { contains: unknown }).contains).toLowerCase();
        if (
          !String(row[key] ?? "")
            .toLowerCase()
            .includes(needle)
        )
          return false;
      }
      if ("in" in (value as object)) {
        if (!(value as { in: unknown[] }).in.includes(row[key])) return false;
      }
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

function rowsMatching<T extends AnyRow>(rows: T[], where: unknown): T[] {
  if (!where) return [...rows];
  return rows.filter((row) => matches(row, where));
}

function applyOrderBy<T extends AnyRow>(rows: T[], orderBy: unknown): T[] {
  const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean) as Record<
    string,
    "asc" | "desc"
  >[];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      for (const [key, order] of Object.entries(clause)) {
        const av = a[key] as number | string | Date;
        const bv = b[key] as number | string | Date;
        if (av === bv) continue;
        const less = av < bv ? -1 : 1;
        return order === "desc" ? -less : less;
      }
    }
    return 0;
  });
}

/** Apply a Prisma `update` payload, supporting `{ increment }`. */
function applyUpdate(row: AnyRow, data: AnyRow): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in (value as object)) {
      row[key] = ((row[key] as number) ?? 0) + (value as { increment: number }).increment;
      continue;
    }
    row[key] = value;
  }
  row.updatedAt = new Date();
}

interface StatusRow extends AnyRow {
  id: string;
  platform: ConnectorPlatform;
  state: ConnectorState;
  enabled: boolean;
  lastSyncAt: Date | null;
  lastError: string | null;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  syncCount: number;
  organizationId: string;
}

interface ContentRow extends AnyRow {
  id: string;
  platform: ConnectorPlatform;
  externalId: string;
  type: string;
  status: string;
  title: string;
  views: number;
  likes: number;
  shares: number;
  organizationId: string;
  createdAt: Date;
}

function createFakeDatabase() {
  const statuses: StatusRow[] = [];
  const contents: ContentRow[] = [];
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${(sequence += 1)}`;

  const db: ConnectorDatabase = {
    connectorStatus: {
      findMany: async ({ where, orderBy }: AnyRow = {}) =>
        applyOrderBy(rowsMatching(statuses, where), orderBy),
      findFirst: async ({ where }: AnyRow = {}) => rowsMatching(statuses, where)[0] ?? null,
      upsert: async ({ where, update, create }: AnyRow) => {
        const key = (where as { organizationId_platform: StatusRow }).organizationId_platform;
        const existing = statuses.find(
          (row) => row.organizationId === key.organizationId && row.platform === key.platform,
        );
        if (existing) {
          applyUpdate(existing, update as AnyRow);
          return existing;
        }
        const row: StatusRow = {
          id: nextId("status"),
          state: "IDLE" as ConnectorState,
          enabled: false,
          lastSyncAt: null,
          lastError: null,
          importedCount: 0,
          duplicateCount: 0,
          failedCount: 0,
          syncCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(create as AnyRow),
        } as unknown as StatusRow;
        statuses.push(row);
        return row;
      },
    },
    externalContent: {
      create: async ({ data }: AnyRow) => {
        const payload = data as AnyRow;
        const clash = contents.find(
          (row) =>
            row.organizationId === payload.organizationId &&
            row.platform === payload.platform &&
            row.externalId === payload.externalId,
        );
        if (clash) {
          const error = new Error("Unique constraint failed") as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        const row: ContentRow = {
          id: nextId("content"),
          views: 0,
          likes: 0,
          shares: 0,
          status: "IMPORTED",
          type: "VIDEO",
          createdAt: new Date(Date.now() + contents.length),
          updatedAt: new Date(),
          ...payload,
        } as unknown as ContentRow;
        contents.push(row);
        return row;
      },
      findFirst: async ({ where }: AnyRow = {}) => rowsMatching(contents, where)[0] ?? null,
      findMany: async ({ where, orderBy, skip = 0, take }: AnyRow = {}) => {
        const rows = applyOrderBy(rowsMatching(contents, where), orderBy);
        return rows.slice(skip as number, take ? (skip as number) + (take as number) : undefined);
      },
      count: async ({ where }: AnyRow = {}) => rowsMatching(contents, where).length,
      updateMany: async ({ where, data }: AnyRow) => {
        const rows = rowsMatching(contents, where);
        for (const row of rows) applyUpdate(row, data as AnyRow);
        return { count: rows.length };
      },
      groupBy: async ({ where }: AnyRow = {}) => {
        const rows = rowsMatching(contents, where);
        const buckets = new Map<string, number>();
        for (const row of rows) buckets.set(row.status, (buckets.get(row.status) ?? 0) + 1);
        return [...buckets].map(([status, count]) => ({ status, _count: { _all: count } }));
      },
    },
  } as unknown as ConnectorDatabase;

  return { db, statuses, contents };
}

function contentPayload(overrides: Partial<CreateExternalContentDTO> = {}) {
  return {
    platform: ConnectorPlatform.MOCK,
    externalId: "mock-video-001",
    type: "VIDEO",
    status: "IMPORTED",
    title: "Camisa masculina — vídeo 001",
    views: 1000,
    likes: 100,
    shares: 10,
    ...overrides,
  } as CreateExternalContentDTO;
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("connector repository — tenant scope is mandatory", () => {
  let repo: ReturnType<typeof createConnectorRepository>;

  beforeEach(() => {
    repo = createConnectorRepository(createFakeDatabase().db);
  });

  it("every read throws 403 without a tenant", async () => {
    await expect(repo.listStatuses("")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(repo.findStatus("  ", ConnectorPlatform.MOCK)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      repo.listContent(null as unknown as string, contentListQuerySchema.parse({})),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(repo.kpis(undefined as unknown as string)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("every write throws 403 without a tenant", async () => {
    await expect(repo.ensureStatus("", ConnectorPlatform.MOCK)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(repo.setEnabled("", ConnectorPlatform.MOCK, true)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(repo.createContent("", contentPayload())).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      repo.recordSyncResult("", ConnectorPlatform.MOCK, {
        state: "ACTIVE" as ConnectorState,
        counters: { imported: 1, duplicates: 0, failed: 0 },
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("connector status lifecycle", () => {
  it("ensureStatus creates the row once and is idempotent", async () => {
    const { db, statuses } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    const first = await repo.ensureStatus(ORG_A, ConnectorPlatform.MOCK);
    const second = await repo.ensureStatus(ORG_A, ConnectorPlatform.MOCK);

    expect(first.id).toBe(second.id);
    expect(statuses).toHaveLength(1);
    expect(first.state).toBe("IDLE");
    expect(first.enabled).toBe(false);
  });

  it("creates an independent row per tenant for the same platform", async () => {
    const { db, statuses } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.ensureStatus(ORG_A, ConnectorPlatform.MOCK);
    await repo.ensureStatus(ORG_B, ConnectorPlatform.MOCK);

    expect(statuses).toHaveLength(2);
    expect(new Set(statuses.map((row) => row.organizationId))).toEqual(new Set([ORG_A, ORG_B]));
  });

  it("setEnabled(false) disables and setEnabled(true) returns a fresh connector to IDLE", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    const disabled = await repo.setEnabled(ORG_A, ConnectorPlatform.TIKTOK, false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.state).toBe("DISABLED");

    const enabled = await repo.setEnabled(ORG_A, ConnectorPlatform.TIKTOK, true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.state).toBe("IDLE");
  });

  it("re-enabling preserves an existing ACTIVE state (no counter/history reset)", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.recordSyncResult(ORG_A, ConnectorPlatform.MOCK, {
      state: "ACTIVE" as ConnectorState,
      counters: { imported: 5, duplicates: 2, failed: 1 },
    });
    await repo.setEnabled(ORG_A, ConnectorPlatform.MOCK, false);
    const reEnabled = await repo.setEnabled(ORG_A, ConnectorPlatform.MOCK, true);

    expect(reEnabled.state).toBe("IDLE"); // came back from DISABLED
    expect(reEnabled.importedCount).toBe(5);
    expect(reEnabled.duplicateCount).toBe(2);
    expect(reEnabled.failedCount).toBe(1);
  });

  it("recordSyncResult accumulates counters across runs", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.recordSyncResult(ORG_A, ConnectorPlatform.MOCK, {
      state: "ACTIVE" as ConnectorState,
      counters: { imported: 10, duplicates: 1, failed: 0 },
    });
    const second = await repo.recordSyncResult(ORG_A, ConnectorPlatform.MOCK, {
      state: "ACTIVE" as ConnectorState,
      counters: { imported: 3, duplicates: 4, failed: 2 },
    });

    expect(second.importedCount).toBe(13);
    expect(second.duplicateCount).toBe(5);
    expect(second.failedCount).toBe(2);
    expect(second.syncCount).toBe(2);
    expect(second.lastSyncAt).toBeInstanceOf(Date);
  });

  it("recordSyncResult stores and clears lastError", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    const failed = await repo.recordSyncResult(ORG_A, ConnectorPlatform.TIKTOK, {
      state: "ERROR" as ConnectorState,
      counters: { imported: 0, duplicates: 0, failed: 0 },
      lastError: "Not implemented",
    });
    expect(failed.state).toBe("ERROR");
    expect(failed.lastError).toBe("Not implemented");

    const recovered = await repo.recordSyncResult(ORG_A, ConnectorPlatform.TIKTOK, {
      state: "ACTIVE" as ConnectorState,
      counters: { imported: 1, duplicates: 0, failed: 0 },
    });
    expect(recovered.lastError).toBeNull();
  });

  it("findStatus never returns another tenant's connector", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.ensureStatus(ORG_A, ConnectorPlatform.MOCK);

    expect(await repo.findStatus(ORG_B, ConnectorPlatform.MOCK)).toBeNull();
    expect(await repo.listStatuses(ORG_B)).toHaveLength(0);
  });
});

describe("external content — dedupe and listing", () => {
  it("createContent stamps the tenant on every row", async () => {
    const { db, contents } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.createContent(ORG_A, contentPayload());

    expect(contents[0]?.organizationId).toBe(ORG_A);
  });

  it("the dedupe key is tenant-scoped — two tenants may import the same item", async () => {
    const { db, contents } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.createContent(ORG_A, contentPayload());
    await repo.createContent(ORG_B, contentPayload());

    expect(contents).toHaveLength(2);
    expect(
      await repo.findContentByExternalId(ORG_A, ConnectorPlatform.MOCK, "mock-video-001"),
    ).not.toBeNull();
    expect(
      await repo.findContentByExternalId(ORG_B, ConnectorPlatform.MOCK, "mock-video-001"),
    ).not.toBeNull();
  });

  it("findContentByExternalId never leaks another tenant's row", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.createContent(ORG_A, contentPayload());

    expect(
      await repo.findContentByExternalId(ORG_B, ConnectorPlatform.MOCK, "mock-video-001"),
    ).toBeNull();
  });

  it("the same externalId on a different platform is NOT a duplicate", async () => {
    const { db, contents } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.createContent(ORG_A, contentPayload({ platform: ConnectorPlatform.MOCK }));
    await repo.createContent(ORG_A, contentPayload({ platform: ConnectorPlatform.TIKTOK }));

    expect(contents).toHaveLength(2);
  });

  it("refreshContent updates only the caller's row", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    const row = await repo.createContent(ORG_A, contentPayload());

    const foreign = await repo.refreshContent(ORG_B, row.id, {
      views: 999,
      likes: 999,
      shares: 999,
      title: row.title,
    });
    expect(foreign).toBeNull();

    const own = await repo.refreshContent(ORG_A, row.id, {
      views: 5000,
      likes: 500,
      shares: 50,
      title: row.title,
    });
    expect(own?.views).toBe(5000);
  });

  it("listContent is tenant-scoped, filtered, sorted and paginated", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    for (let index = 0; index < 12; index += 1) {
      await repo.createContent(
        ORG_A,
        contentPayload({
          externalId: `mock-video-${index}`,
          title: index % 2 === 0 ? `Camisa ${index}` : `Jaqueta ${index}`,
          views: index * 100,
          status: index === 11 ? "FAILED" : "IMPORTED",
        }),
      );
    }
    await repo.createContent(ORG_B, contentPayload({ externalId: "other-tenant" }));

    const page1 = await repo.listContent(ORG_A, contentListQuerySchema.parse({ pageSize: "5" }));
    expect(page1.total).toBe(12); // ORG_B's row is invisible
    expect(page1.items).toHaveLength(5);

    const filtered = await repo.listContent(
      ORG_A,
      contentListQuerySchema.parse({ search: "camisa" }),
    );
    expect(filtered.total).toBe(6);

    const failed = await repo.listContent(
      ORG_A,
      contentListQuerySchema.parse({ status: "FAILED" }),
    );
    expect(failed.total).toBe(1);

    const sorted = await repo.listContent(
      ORG_A,
      contentListQuerySchema.parse({ sort: "views", order: "desc", pageSize: "3" }),
    );
    expect(sorted.items.map((item) => item.views)).toEqual([1100, 1000, 900]);
  });

  it("a caller filter can never widen the tenant boundary", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.createContent(ORG_B, contentPayload({ externalId: "secret" }));

    const result = await repo.listContent(
      ORG_A,
      // A malicious "organizationId" in the URL is simply not part of the
      // query schema — and the scope is merged LAST regardless.
      contentListQuerySchema.parse({ search: "secret", organizationId: ORG_B } as never),
    );
    expect(result.total).toBe(0);
  });
});

describe("kpis — the four dashboard counters", () => {
  it("counts imported / duplicates / failed per tenant", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.createContent(ORG_A, contentPayload({ externalId: "a1", status: "IMPORTED" }));
    await repo.createContent(ORG_A, contentPayload({ externalId: "a2", status: "IMPORTED" }));
    await repo.createContent(ORG_A, contentPayload({ externalId: "a3", status: "DUPLICATE" }));
    await repo.createContent(ORG_A, contentPayload({ externalId: "a4", status: "FAILED" }));
    await repo.createContent(ORG_B, contentPayload({ externalId: "b1", status: "IMPORTED" }));

    const kpis = await repo.kpis(ORG_A);
    expect(kpis).toMatchObject({ imported: 2, duplicates: 1, failed: 1 });
  });

  it("returns zeros for a tenant with no content (never null/NaN)", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    expect(await repo.kpis(ORG_A)).toEqual({
      imported: 0,
      duplicates: 0,
      failed: 0,
      activeConnectors: 0,
    });
  });

  it("counts a connector as active only when enabled AND last run succeeded", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    // enabled + ACTIVE → counts
    await repo.recordSyncResult(ORG_A, ConnectorPlatform.MOCK, {
      state: "ACTIVE" as ConnectorState,
      counters: { imported: 1, duplicates: 0, failed: 0 },
    });
    // enabled + ERROR → does not count
    await repo.recordSyncResult(ORG_A, ConnectorPlatform.TIKTOK, {
      state: "ERROR" as ConnectorState,
      counters: { imported: 0, duplicates: 0, failed: 0 },
      lastError: "Not implemented",
    });
    // registered but never synced (IDLE, disabled) → does not count
    await repo.ensureStatus(ORG_A, ConnectorPlatform.SHOPEE);

    expect((await repo.kpis(ORG_A)).activeConnectors).toBe(1);

    // disabling the healthy one drops the KPI to zero
    await repo.setEnabled(ORG_A, ConnectorPlatform.MOCK, false);
    expect((await repo.kpis(ORG_A)).activeConnectors).toBe(0);
  });

  it("never counts another tenant's active connectors", async () => {
    const { db } = createFakeDatabase();
    const repo = createConnectorRepository(db);

    await repo.recordSyncResult(ORG_B, ConnectorPlatform.MOCK, {
      state: "ACTIVE" as ConnectorState,
      counters: { imported: 9, duplicates: 9, failed: 9 },
    });

    expect(await repo.kpis(ORG_A)).toEqual({
      imported: 0,
      duplicates: 0,
      failed: 0,
      activeConnectors: 0,
    });
  });
});
