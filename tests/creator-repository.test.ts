import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreatorSource, CreatorStatus, type Prisma } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import type { CreateCreatorDTO, DiscoveryUpsertDTO } from "@/modules/creators/crm/dto/creator.dto";
import {
  createCreatorRepository,
  type CreatorDatabase,
} from "@/modules/creators/crm/repositories/creator-profile.repository";
import { creatorListQuerySchema } from "@/modules/creators/crm/validators/creator.validator";
import { PREMIUM_CREATOR_SCORE_THRESHOLD } from "@/modules/creators/discovery/scorer";

/**
 * PR003 — Creator repository, tested against an in-memory fake Prisma.
 *
 * The repository is created through `createCreatorRepository(db)` exactly
 * as production does — only the database is faked — so these tests
 * exercise the real tenant-isolation contract:
 *
 *   1. every query carries `organizationId`;
 *   2. a missing/blank tenant throws BEFORE any database call;
 *   3. one tenant can never read, update or aggregate another tenant's
 *      creators.
 *
 * (`@/lib/prisma` is mocked so importing the repository module does not
 * instantiate a PrismaClient in the test environment.)
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const ORG_A = "org_tenant_a";
const ORG_B = "org_tenant_b";

// ------------------------------------------------------------------
// In-memory fake Prisma (subset used by the creators repository)
// ------------------------------------------------------------------

interface ProfileRow {
  [key: string]: unknown;
  id: string;
  handle: string;
  displayName: string;
  niche: string;
  followers: number;
  avgViews: number;
  engagementRate: number;
  creatorScore: number;
  status: CreatorStatus;
  source: CreatorSource;
  externalId: string | null;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MetricRow {
  [key: string]: unknown;
  id: string;
  date: Date;
  views: number;
  likes: number;
  shares: number;
  followers: number;
  creatorProfileId: string;
  organizationId: string;
}

interface TagRow {
  [key: string]: unknown;
  id: string;
  name: string;
  creatorProfileId: string;
  organizationId: string;
}

type AnyRow = Record<string, unknown>;

/** Prisma-`where` subset: equality · contains (insensitive) · gte · in · OR. */
function matches(row: AnyRow, condition: unknown): boolean {
  if (condition === undefined || condition === null) return true;
  if (typeof condition !== "object") return row !== undefined && row === condition;

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
        if (!String(row[key]).toLowerCase().includes(needle)) return false;
      }
      if ("gte" in (value as object)) {
        if (!((row[key] as number) >= (value as { gte: number }).gte)) return false;
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
        const av = a[key] as number | string;
        const bv = b[key] as number | string;
        if (av < bv) return order === "desc" ? 1 : -1;
        if (av > bv) return order === "desc" ? -1 : 1;
      }
    }
    return 0;
  });
}

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${(idCounter += 1)}`;
const NOW = new Date("2026-09-22T12:00:00.000Z");

function createFakeDb() {
  const profiles: ProfileRow[] = [];
  const metrics: MetricRow[] = [];
  const tags: TagRow[] = [];

  const db = {
    creatorProfile: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: nextId("creator"),
          createdAt: NOW,
          updatedAt: NOW,
          ...data,
        } as unknown as ProfileRow;
        profiles.push(row);
        return row;
      }),
      findFirst: vi.fn(async (args: Prisma.CreatorProfileFindFirstArgs) => {
        let rows = rowsMatching(profiles, args.where);
        rows = applyOrderBy(rows, args.orderBy);
        return rows[0] ?? null;
      }),
      findMany: vi.fn(async (args: Prisma.CreatorProfileFindManyArgs) => {
        let rows = applyOrderBy(rowsMatching(profiles, args.where) as ProfileRow[], args.orderBy);
        if (args.skip !== undefined) rows = rows.slice(args.skip);
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows;
      }),
      count: vi.fn(
        async (args: Prisma.CreatorProfileCountArgs) => rowsMatching(profiles, args.where).length,
      ),
      updateMany: vi.fn(async (args: Prisma.CreatorProfileUpdateManyArgs) => {
        const rows = rowsMatching(profiles, args.where);
        for (const row of rows) {
          Object.assign(row, args.data, { updatedAt: new Date() });
        }
        return { count: rows.length };
      }),
      update: vi.fn(async (args: Prisma.CreatorProfileUpdateArgs) => {
        const row = profiles.find((candidate) =>
          matches(candidate, args.where as unknown as Record<string, unknown>),
        );
        if (!row) throw new Error("Record not found");
        Object.assign(row, args.data, { updatedAt: new Date() });
        return row;
      }),
      aggregate: vi.fn(async (args: Prisma.CreatorProfileAggregateArgs) => {
        const rows = rowsMatching(profiles, args.where) as ProfileRow[];
        const avg = args._avg as { creatorScore?: boolean } | undefined;
        return {
          _count: rows.length,
          _avg: {
            creatorScore:
              avg?.creatorScore && rows.length > 0
                ? rows.reduce((sum, row) => sum + row.creatorScore, 0) / rows.length
                : null,
          },
        };
      }),
      groupBy: vi.fn(async (args: { by: string[]; where?: unknown; _count?: unknown }) => {
        const rows = rowsMatching(profiles, args.where);
        const byStatus = new Map<string, number>();
        for (const row of rows) {
          const key = String(row[args.by[0]!] ?? "");
          byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
        }
        return [...byStatus.entries()].map(([status, count]) => ({
          status,
          _count: { _all: count },
        }));
      }),
    },
    creatorMetric: {
      upsert: vi.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { creatorProfileId_date: { creatorProfileId: string; date: Date } };
          update: Record<string, number>;
          create: Record<string, unknown>;
        }) => {
          const { creatorProfileId, date } = where.creatorProfileId_date;
          const key = (metric: MetricRow) =>
            metric.creatorProfileId === creatorProfileId &&
            metric.date.getTime() === date.getTime();
          const existing = metrics.find(key);
          if (existing) {
            Object.assign(existing, update, { updatedAt: new Date() });
            return existing;
          }
          const row = {
            id: nextId("metric"),
            createdAt: NOW,
            updatedAt: NOW,
            ...create,
          } as unknown as MetricRow;
          metrics.push(row);
          return row;
        },
      ),
    },
    creatorTag: {
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { creatorProfileId_name: { creatorProfileId: string; name: string } };
          create: Record<string, unknown>;
        }) => {
          const { creatorProfileId, name } = where.creatorProfileId_name;
          const existing = tags.find(
            (tag) => tag.creatorProfileId === creatorProfileId && tag.name === name,
          );
          if (existing) return existing;
          const row = {
            id: nextId("tag"),
            createdAt: NOW,
            updatedAt: NOW,
            ...create,
          } as unknown as TagRow;
          tags.push(row);
          return row;
        },
      ),
    },
  } as unknown as CreatorDatabase & {
    __profiles: ProfileRow[];
    __metrics: MetricRow[];
    __tags: TagRow[];
  };

  Object.defineProperty(db, "__profiles", { value: profiles });
  Object.defineProperty(db, "__metrics", { value: metrics });
  Object.defineProperty(db, "__tags", { value: tags });

  return db;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const CREATE_DTO: CreateCreatorDTO = {
  handle: "@ana.souza",
  displayName: "Ana Souza",
  niche: "Moda",
  followers: 10_000,
  avgViews: 4_000,
  engagementRate: 6.5,
  creatorScore: 42,
  status: CreatorStatus.NEW,
  source: CreatorSource.MANUAL,
};

function discoveryDto(overrides: Partial<DiscoveryUpsertDTO> = {}): DiscoveryUpsertDTO {
  return {
    externalId: "mock-moda-001",
    handle: "@ana.souza",
    displayName: "Ana Souza",
    niche: "Moda",
    followers: 10_000,
    avgViews: 4_000,
    engagementRate: 6.5,
    creatorScore: 42,
    status: CreatorStatus.NEW,
    source: CreatorSource.MOCK,
    ...overrides,
  };
}

describe("creatorRepository — tenant guard", () => {
  it("throws BEFORE any database call on a blank tenant", async () => {
    const db = createFakeDb();
    const repository = createCreatorRepository(db);

    await expect(repository.createCreator("", CREATE_DTO)).rejects.toThrow(AuthorizationError);
    await expect(repository.listCreators("  ", creatorListQuerySchema.parse({}))).rejects.toThrow(
      AuthorizationError,
    );
    await expect(repository.topCreators(undefined as unknown as string)).rejects.toThrow(
      AuthorizationError,
    );
    await expect(
      repository.changeStatus(null as unknown as string, "x", CreatorStatus.ACTIVE),
    ).rejects.toThrow(AuthorizationError);
    await expect(repository.stats("")).rejects.toThrow(AuthorizationError);
    await expect(repository.pipeline("")).rejects.toThrow(AuthorizationError);
    await expect(repository.upsertFromDiscovery("", discoveryDto())).rejects.toThrow(
      AuthorizationError,
    );

    expect(db.creatorProfile.create).not.toHaveBeenCalled();
    expect(db.creatorProfile.findMany).not.toHaveBeenCalled();
    expect(db.creatorProfile.count).not.toHaveBeenCalled();
    expect(db.creatorProfile.groupBy).not.toHaveBeenCalled();
  });
});

describe("creatorRepository — createCreator", () => {
  let db: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createCreatorRepository>;

  beforeEach(() => {
    db = createFakeDb();
    repository = createCreatorRepository(db);
  });

  it("stamps the tenant on the created row", async () => {
    const creator = await repository.createCreator(ORG_A, CREATE_DTO);
    expect(creator.organizationId).toBe(ORG_A);
    expect(creator.handle).toBe(CREATE_DTO.handle);
    expect(db.__profiles).toHaveLength(1);
  });

  it("never lets data override the tenant scope", async () => {
    const creator = await repository.createCreator(ORG_A, {
      ...CREATE_DTO,
      // A hostile payload tries to write into another tenant.
      organizationId: ORG_B,
    } as CreateCreatorDTO);
    expect(creator.organizationId).toBe(ORG_A);
  });
});

describe("creatorRepository — listCreators", () => {
  let db: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createCreatorRepository>;

  beforeEach(async () => {
    db = createFakeDb();
    repository = createCreatorRepository(db);
    // Tenant A: 3 creators · Tenant B: 1 creator.
    await repository.createCreator(ORG_A, { ...CREATE_DTO, handle: "@a.one", creatorScore: 30 });
    await repository.createCreator(ORG_A, {
      ...CREATE_DTO,
      handle: "@a.two",
      displayName: "Bruno",
      creatorScore: 90,
      niche: "Street",
    });
    await repository.createCreator(ORG_A, {
      ...CREATE_DTO,
      handle: "@a.three",
      creatorScore: 60,
      status: CreatorStatus.ACTIVE,
    });
    await repository.createCreator(ORG_B, { ...CREATE_DTO, handle: "@b.one", creatorScore: 99 });
  });

  it("only lists the caller's tenant", async () => {
    const { items, total } = await repository.listCreators(ORG_A, creatorListQuerySchema.parse({}));
    expect(total).toBe(3);
    expect(items.every((item) => item.organizationId === ORG_A)).toBe(true);
    expect(items.map((item) => item.handle)).not.toContain("@b.one");
  });

  it("paginates (page · pageSize · total)", async () => {
    const page1 = await repository.listCreators(
      ORG_A,
      creatorListQuerySchema.parse({ pageSize: 2 }),
    );
    const page2 = await repository.listCreators(
      ORG_A,
      creatorListQuerySchema.parse({ page: 2, pageSize: 2 }),
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page2.items).toHaveLength(1);
    expect(new Set([...page1.items, ...page2.items]).size).toBe(3);
  });

  it("searches handle and display name (case-insensitive)", async () => {
    const byHandle = await repository.listCreators(
      ORG_A,
      creatorListQuerySchema.parse({ search: "A.TWO" }),
    );
    const byName = await repository.listCreators(
      ORG_A,
      creatorListQuerySchema.parse({ search: "bruno" }),
    );
    expect(byHandle.total).toBe(1);
    expect(byHandle.items[0]!.handle).toBe("@a.two");
    expect(byName.total).toBe(1);
    expect(byName.items[0]!.displayName).toBe("Bruno");
  });

  it("filters by status and niche", async () => {
    const active = await repository.listCreators(
      ORG_A,
      creatorListQuerySchema.parse({ status: "ACTIVE" }),
    );
    const street = await repository.listCreators(
      ORG_A,
      creatorListQuerySchema.parse({ niche: "Street" }),
    );
    expect(active.total).toBe(1);
    expect(active.items[0]!.status).toBe(CreatorStatus.ACTIVE);
    expect(street.total).toBe(1);
    expect(street.items[0]!.niche).toBe("Street");
  });

  it("sorts by the requested column and order", async () => {
    const asc = await repository.listCreators(
      ORG_A,
      creatorListQuerySchema.parse({ sort: "creatorScore", order: "asc" }),
    );
    const desc = await repository.listCreators(
      ORG_A,
      creatorListQuerySchema.parse({ sort: "creatorScore", order: "desc" }),
    );
    expect(asc.items.map((item) => item.creatorScore)).toEqual([30, 60, 90]);
    expect(desc.items.map((item) => item.creatorScore)).toEqual([90, 60, 30]);
  });

  it("combines search + filter + sort", async () => {
    const result = await repository.listCreators(
      ORG_A,
      creatorListQuerySchema.parse({ search: "a.", niche: "Moda", sort: "handle", order: "asc" }),
    );
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.handle)).toEqual(["@a.one", "@a.three"]);
  });
});

describe("creatorRepository — topCreators", () => {
  let db: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createCreatorRepository>;

  beforeEach(async () => {
    db = createFakeDb();
    repository = createCreatorRepository(db);
    for (let i = 1; i <= 5; i += 1) {
      await repository.createCreator(ORG_A, {
        ...CREATE_DTO,
        handle: `@top${i}`,
        creatorScore: i * 10,
        followers: i * 100,
      });
    }
    await repository.createCreator(ORG_B, { ...CREATE_DTO, handle: "@other", creatorScore: 100 });
  });

  it("orders by score (desc), then followers, then handle", async () => {
    const top = await repository.topCreators(ORG_A, { limit: 3 });
    expect(top.map((item) => item.creatorScore)).toEqual([50, 40, 30]);
  });

  it("respects the limit (default 10)", async () => {
    expect(await repository.topCreators(ORG_A)).toHaveLength(5);
    expect(await repository.topCreators(ORG_A, { limit: 2 })).toHaveLength(2);
  });

  it("never returns another tenant's creators", async () => {
    const top = await repository.topCreators(ORG_A, { limit: 10 });
    expect(top.some((item) => item.organizationId === ORG_B)).toBe(false);
  });

  it("filters by minScore (premium feed)", async () => {
    const premium = await repository.topCreators(ORG_A, { minScore: 40 });
    expect(premium.map((item) => item.creatorScore)).toEqual([50, 40]);
  });

  it("filters by status", async () => {
    await repository.changeStatus(
      ORG_A,
      (await repository.topCreators(ORG_A, { limit: 1 }))[0]!.id,
      CreatorStatus.ACTIVE,
    );
    const active = await repository.topCreators(ORG_A, { status: CreatorStatus.ACTIVE });
    expect(active).toHaveLength(1);
    expect(active[0]!.status).toBe(CreatorStatus.ACTIVE);
  });
});

describe("creatorRepository — updateCreator / changeStatus / findById", () => {
  let db: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createCreatorRepository>;
  let creatorA: { id: string };

  beforeEach(async () => {
    db = createFakeDb();
    repository = createCreatorRepository(db);
    creatorA = await repository.createCreator(ORG_A, CREATE_DTO);
    await repository.createCreator(ORG_B, { ...CREATE_DTO, handle: "@b.one" });
  });

  it("updateCreator updates within the tenant and returns the row", async () => {
    const updated = await repository.updateCreator(ORG_A, creatorA.id, {
      displayName: "Novo Nome",
    });
    expect(updated?.displayName).toBe("Novo Nome");
  });

  it("updateCreator returns null for a foreign id (no cross-tenant write)", async () => {
    const foreign = db.__profiles.find((row) => row.organizationId === ORG_B)!;
    const result = await repository.updateCreator(ORG_A, foreign.id, { displayName: "Hack" });
    expect(result).toBeNull();
    expect(foreign.displayName).not.toBe("Hack");
  });

  it("updateCreator returns null for an unknown id", async () => {
    expect(
      await repository.updateCreator(ORG_A, "does-not-exist", { displayName: "X" }),
    ).toBeNull();
  });

  it("changeStatus moves the profile and returns it", async () => {
    const updated = await repository.changeStatus(ORG_A, creatorA.id, CreatorStatus.QUALIFIED);
    expect(updated?.status).toBe(CreatorStatus.QUALIFIED);
  });

  it("changeStatus never touches a foreign profile", async () => {
    const foreign = db.__profiles.find((row) => row.organizationId === ORG_B)!;
    const result = await repository.changeStatus(ORG_A, foreign.id, CreatorStatus.ACTIVE);
    expect(result).toBeNull();
    expect(foreign.status).toBe(CreatorStatus.NEW);
  });

  it("findById only sees the caller's tenant", async () => {
    expect(await repository.findById(ORG_A, creatorA.id)).not.toBeNull();
    const foreign = db.__profiles.find((row) => row.organizationId === ORG_B)!;
    expect(await repository.findById(ORG_A, foreign.id)).toBeNull();
  });
});

describe("creatorRepository — stats (KPIs)", () => {
  let db: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createCreatorRepository>;

  beforeEach(async () => {
    db = createFakeDb();
    repository = createCreatorRepository(db);
    const rows: Array<[number, CreatorStatus]> = [
      [90, CreatorStatus.ACTIVE],
      [85, CreatorStatus.CONTACTED],
      [82, CreatorStatus.NEGOTIATING],
      [70, CreatorStatus.NEW],
      [10, CreatorStatus.NEW],
      [10, CreatorStatus.ARCHIVED],
    ];
    for (const [score, status] of rows) {
      await repository.createCreator(ORG_A, {
        ...CREATE_DTO,
        handle: `@s${score}${status}`,
        creatorScore: score,
        status,
      });
    }
    // Distractor rows in another tenant.
    await repository.createCreator(ORG_B, {
      ...CREATE_DTO,
      handle: "@b.premium",
      creatorScore: 100,
    });
    await repository.createCreator(ORG_B, {
      ...CREATE_DTO,
      handle: "@b.active",
      status: CreatorStatus.ACTIVE,
    });
  });

  it("counts only the tenant's creators", async () => {
    const stats = await repository.stats(ORG_A);
    expect(stats.totalCreators).toBe(6);
  });

  it("averages the score (rounded) over the tenant", async () => {
    const stats = await repository.stats(ORG_A);
    // (90+85+82+70+10+10)/6 = 57.83 → 58
    expect(stats.averageScore).toBe(58);
  });

  it("counts premium profiles at the threshold (>= 80)", async () => {
    const stats = await repository.stats(ORG_A);
    expect(stats.premiumCount).toBe(3);
    expect(PREMIUM_CREATOR_SCORE_THRESHOLD).toBe(80);
  });

  it("counts contacted profiles (CONTACTED · NEGOTIATING · ACTIVE)", async () => {
    const stats = await repository.stats(ORG_A);
    expect(stats.contactedCount).toBe(3);
  });

  it("returns a count for every pipeline status (zero-filled)", async () => {
    const stats = await repository.stats(ORG_A);
    expect(stats.statusCounts).toEqual({
      NEW: 2,
      QUALIFIED: 0,
      CONTACTED: 1,
      NEGOTIATING: 1,
      ACTIVE: 1,
      ARCHIVED: 1,
    });
  });

  it("returns null averageScore for an empty base", async () => {
    const stats = await repository.stats(ORG_B + "_empty");
    expect(stats.totalCreators).toBe(0);
    expect(stats.averageScore).toBeNull();
    expect(stats.premiumCount).toBe(0);
    expect(stats.contactedCount).toBe(0);
  });
});

describe("creatorRepository — pipeline (Kanban)", () => {
  let db: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createCreatorRepository>;

  beforeEach(async () => {
    db = createFakeDb();
    repository = createCreatorRepository(db);
    for (let i = 0; i < 12; i += 1) {
      await repository.createCreator(ORG_A, {
        ...CREATE_DTO,
        handle: `@p${i}`,
        creatorScore: i,
        status: CreatorStatus.NEW,
      });
    }
    await repository.createCreator(ORG_B, { ...CREATE_DTO, handle: "@foreign", creatorScore: 999 });
  });

  it("returns one column per pipeline status, in funnel order", async () => {
    const columns = await repository.pipeline(ORG_A);
    expect(columns.map((column) => column.status)).toEqual([
      "NEW",
      "QUALIFIED",
      "CONTACTED",
      "NEGOTIATING",
      "ACTIVE",
      "ARCHIVED",
    ]);
  });

  it("counts every row per column, even beyond the card cap", async () => {
    const columns = await repository.pipeline(ORG_A, { limitPerColumn: 5 });
    const newColumn = columns.find((column) => column.status === "NEW")!;
    expect(newColumn.count).toBe(12);
    expect(newColumn.items).toHaveLength(5);
  });

  it("caps the cards at limitPerColumn (default 10)", async () => {
    const columns = await repository.pipeline(ORG_A);
    expect(columns.find((column) => column.status === "NEW")!.items).toHaveLength(10);
  });

  it("orders the cards by score (desc)", async () => {
    const columns = await repository.pipeline(ORG_A, { limitPerColumn: 4 });
    const newColumn = columns.find((column) => column.status === "NEW")!;
    expect(newColumn.items.map((item) => item.creatorScore)).toEqual([11, 10, 9, 8]);
  });

  it("never includes another tenant's creators", async () => {
    const columns = await repository.pipeline(ORG_A);
    const allItems = columns.flatMap((column) => column.items);
    expect(allItems.every((item) => item.organizationId === ORG_A)).toBe(true);
    expect(allItems.map((item) => item.handle)).not.toContain("@foreign");
  });
});

describe("creatorRepository — upsertFromDiscovery", () => {
  let db: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createCreatorRepository>;

  beforeEach(() => {
    db = createFakeDb();
    repository = createCreatorRepository(db);
  });

  it("creates on first import and stamps source + tenant", async () => {
    const { creator, created } = await repository.upsertFromDiscovery(ORG_A, discoveryDto());
    expect(created).toBe(true);
    expect(creator.source).toBe(CreatorSource.MOCK);
    expect(creator.organizationId).toBe(ORG_A);
    expect(creator.status).toBe(CreatorStatus.NEW);
  });

  it("updates metrics + score on re-import", async () => {
    await repository.upsertFromDiscovery(ORG_A, discoveryDto({ creatorScore: 42 }));
    const { creator, created } = await repository.upsertFromDiscovery(
      ORG_A,
      discoveryDto({ creatorScore: 77, followers: 20_000 }),
    );
    expect(created).toBe(false);
    expect(creator.creatorScore).toBe(77);
    expect(creator.followers).toBe(20_000);
    expect(db.__profiles).toHaveLength(1);
  });

  it("NEVER overrides the CRM status on re-import", async () => {
    const first = await repository.upsertFromDiscovery(ORG_A, discoveryDto());
    await repository.changeStatus(ORG_A, first.creator.id, CreatorStatus.NEGOTIATING);
    const second = await repository.upsertFromDiscovery(ORG_A, discoveryDto());
    expect(second.creator.status).toBe(CreatorStatus.NEGOTIATING);
  });

  it("keeps tenants apart: the same externalId in two orgs are two profiles", async () => {
    await repository.upsertFromDiscovery(ORG_A, discoveryDto());
    const inB = await repository.upsertFromDiscovery(ORG_B, discoveryDto());
    expect(inB.created).toBe(true);
    expect(db.__profiles).toHaveLength(2);
    expect(new Set(db.__profiles.map((row) => row.organizationId))).toEqual(
      new Set([ORG_A, ORG_B]),
    );
  });

  it("scopes the dedupe lookup to the caller's tenant", async () => {
    await repository.upsertFromDiscovery(ORG_B, discoveryDto());
    const inA = await repository.upsertFromDiscovery(ORG_A, discoveryDto());
    expect(inA.created).toBe(true); // ORG_A does not see ORG_B's profile
  });
});

describe("creatorRepository — recordMetric / addTag", () => {
  let db: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createCreatorRepository>;
  let creatorA: { id: string };

  beforeEach(async () => {
    db = createFakeDb();
    repository = createCreatorRepository(db);
    creatorA = await repository.createCreator(ORG_A, CREATE_DTO);
  });

  it("recordMetric upserts by (creator, date)", async () => {
    const date = new Date("2026-09-22T00:00:00.000Z");
    const first = await repository.recordMetric(ORG_A, creatorA.id, {
      date,
      views: 100,
      likes: 10,
      shares: 1,
      followers: 5_000,
    });
    expect(first).not.toBeNull();
    const second = await repository.recordMetric(ORG_A, creatorA.id, {
      date,
      views: 200,
      likes: 20,
      shares: 2,
      followers: 6_000,
    });
    expect(db.__metrics).toHaveLength(1);
    expect(second?.views).toBe(200);
    expect(second?.followers).toBe(6_000);
  });

  it("recordMetric returns null for a foreign profile id", async () => {
    const foreign = await repository.createCreator(ORG_B, { ...CREATE_DTO, handle: "@b.one" });
    const result = await repository.recordMetric(ORG_A, foreign.id, {
      date: new Date(),
      views: 1,
      likes: 1,
      shares: 1,
      followers: 1,
    });
    expect(result).toBeNull();
    expect(db.__metrics).toHaveLength(0);
  });

  it("addTag attaches a tag once (idempotent)", async () => {
    await repository.addTag(ORG_A, creatorA.id, "premium");
    await repository.addTag(ORG_A, creatorA.id, "premium");
    expect(db.__tags).toHaveLength(1);
    expect(db.__tags[0]!.name).toBe("premium");
    expect(db.__tags[0]!.organizationId).toBe(ORG_A);
  });

  it("addTag returns null for a foreign profile id", async () => {
    const foreign = await repository.createCreator(ORG_B, { ...CREATE_DTO, handle: "@b.one" });
    const result = await repository.addTag(ORG_A, foreign.id, "hack");
    expect(result).toBeNull();
    expect(db.__tags).toHaveLength(0);
  });
});
