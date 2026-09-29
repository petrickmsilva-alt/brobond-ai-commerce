import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrendSource, type Prisma } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import type { CreateTrendDTO } from "@/modules/trends/dto/create-trend.dto";
import {
  createTrendRepository,
  type TrendDatabase,
} from "@/modules/trends/repositories/trend.repository";
import { trendListQuerySchema } from "@/modules/trends/validators/trend.validator";

/**
 * PR002 — Trend repository, tested against an in-memory fake Prisma.
 *
 * The repository is created through `createTrendRepository(db)` exactly as
 * production does — only the database is faked — so these tests exercise
 * the real tenant-isolation contract:
 *
 *   1. every query carries `organizationId`;
 *   2. a missing/blank tenant throws BEFORE any database call;
 *   3. one tenant can never read or aggregate another tenant's trends.
 *
 * (`@/lib/prisma` is mocked so importing the repository module does not
 * instantiate a PrismaClient in the test environment.)
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const ORG_A = "org_tenant_a";
const ORG_B = "org_tenant_b";

// ------------------------------------------------------------------
// In-memory fake Prisma (subset used by the trends repository)
// ------------------------------------------------------------------

interface SnapshotRow {
  [key: string]: unknown;
  id: string;
  keyword: string;
  category: string;
  views: number;
  likes: number;
  shares: number;
  trendScore: number;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface KeywordRow {
  [key: string]: unknown;
  id: string;
  keyword: string;
  frequency: number;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

type AnyRow = Record<string, unknown>;

function rowsMatching<T extends AnyRow>(rows: T[], where: unknown): T[] {
  if (!where) return [...rows];
  return rows.filter((row) => {
    for (const [key, condition] of Object.entries(where as Record<string, unknown>)) {
      if (condition === undefined) continue;
      if (typeof condition === "object" && condition !== null) {
        if ("contains" in (condition as object)) {
          const needle = String((condition as { contains: unknown }).contains).toLowerCase();
          if (!String(row[key]).toLowerCase().includes(needle)) return false;
        }
        if ("gte" in (condition as object)) {
          if (!((row[key] as number) >= (condition as { gte: number }).gte)) return false;
        }
        continue;
      }
      if (row[key] !== condition) return false;
    }
    return true;
  });
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

function createFakeDb() {
  const snapshots: SnapshotRow[] = [];
  const keywords: KeywordRow[] = [];
  const categories: AnyRow[] = [];

  const db = {
    trendSnapshot: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: nextId("snap"),
          createdAt: new Date("2026-09-22T12:00:00.000Z"),
          updatedAt: new Date("2026-09-22T12:00:00.000Z"),
          ...data,
        } as SnapshotRow;
        snapshots.push(row);
        return row;
      }),
      findMany: vi.fn(async (args: Prisma.TrendSnapshotFindManyArgs) => {
        let rows = applyOrderBy(rowsMatching(snapshots, args.where) as SnapshotRow[], args.orderBy);
        if (args.skip !== undefined) rows = rows.slice(args.skip);
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows;
      }),
      count: vi.fn(
        async (args: Prisma.TrendSnapshotCountArgs) => rowsMatching(snapshots, args.where).length,
      ),
      aggregate: vi.fn(async (args: Prisma.TrendSnapshotAggregateArgs) => {
        const rows = rowsMatching(snapshots, args.where) as SnapshotRow[];
        const max = args._max as { trendScore?: boolean; createdAt?: boolean } | undefined;
        return {
          _count: rows.length,
          _max: {
            trendScore: max?.trendScore
              ? (rows.map((r) => r.trendScore).sort((a, b) => b - a)[0] ?? null)
              : null,
            createdAt: max?.createdAt
              ? (rows.map((r) => r.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null)
              : null,
          },
        };
      }),
    },
    trendKeyword: {
      upsert: vi.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { organizationId_keyword: { organizationId: string; keyword: string } };
          update: { frequency: { increment: number } };
          create: Record<string, unknown>;
        }) => {
          const { organizationId, keyword } = where.organizationId_keyword;
          const existing = keywords.find(
            (row) => row.organizationId === organizationId && row.keyword === keyword,
          );
          if (existing) {
            existing.frequency += update.frequency.increment;
            existing.updatedAt = new Date();
            return existing;
          }
          const row = {
            id: nextId("kw"),
            createdAt: new Date("2026-09-22T12:00:00.000Z"),
            updatedAt: new Date("2026-09-22T12:00:00.000Z"),
            ...create,
          } as KeywordRow;
          keywords.push(row);
          return row;
        },
      ),
      findMany: vi.fn(async (args: Prisma.TrendKeywordFindManyArgs) => {
        let rows = applyOrderBy(rowsMatching(keywords, args.where) as KeywordRow[], args.orderBy);
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows;
      }),
      count: vi.fn(
        async (args: Prisma.TrendKeywordCountArgs) => rowsMatching(keywords, args.where).length,
      ),
    },
    trendCategory: {
      upsert: vi.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { organizationId_name: { organizationId: string; name: string } };
          update: { score: number };
          create: Record<string, unknown>;
        }) => {
          const { organizationId, name } = where.organizationId_name;
          const existing = categories.find(
            (row) => row.organizationId === organizationId && row.name === name,
          );
          if (existing) {
            existing.score = update.score;
            existing.updatedAt = new Date();
            return existing;
          }
          const row = {
            id: nextId("cat"),
            createdAt: new Date("2026-09-22T12:00:00.000Z"),
            updatedAt: new Date("2026-09-22T12:00:00.000Z"),
            ...create,
          };
          categories.push(row);
          return row;
        },
      ),
      findMany: vi.fn(async (args: Prisma.TrendCategoryFindManyArgs) =>
        applyOrderBy(rowsMatching(categories, args.where), args.orderBy),
      ),
      count: vi.fn(
        async (args: Prisma.TrendCategoryCountArgs) => rowsMatching(categories, args.where).length,
      ),
    },
  };

  return { db: db as unknown as TrendDatabase, raw: db, snapshots, keywords, categories };
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function query(input: Record<string, string | undefined> = {}) {
  return trendListQuerySchema.parse(
    Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
  );
}

function snapshotDTO(overrides: Partial<CreateTrendDTO> = {}): CreateTrendDTO {
  return {
    keyword: "camisa masculina",
    category: "Moda",
    views: 100_000,
    likes: 20_000,
    shares: 3_000,
    trendScore: 70,
    ...overrides,
  };
}

describe("trendRepository — tenant isolation (hard requirement)", () => {
  let fake: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createTrendRepository>;

  beforeEach(() => {
    fake = createFakeDb();
    repository = createTrendRepository(fake.db);
  });

  it("never queries without a tenant — blank org throws before touching the db", async () => {
    for (const organizationId of ["", "   "]) {
      await expect(repository.createSnapshot(organizationId, snapshotDTO())).rejects.toThrow(
        AuthorizationError,
      );
      await expect(repository.listSnapshots(organizationId, query())).rejects.toThrow(
        AuthorizationError,
      );
      await expect(repository.topTrends(organizationId)).rejects.toThrow(AuthorizationError);
      await expect(repository.findKeywords(organizationId)).rejects.toThrow(AuthorizationError);
      await expect(repository.findCategories(organizationId)).rejects.toThrow(AuthorizationError);
      await expect(repository.upsertKeyword(organizationId, "camisa")).rejects.toThrow(
        AuthorizationError,
      );
      await expect(repository.upsertCategory(organizationId, "Moda", 50)).rejects.toThrow(
        AuthorizationError,
      );
      await expect(repository.stats(organizationId)).rejects.toThrow(AuthorizationError);
    }
    // Not a single database call was attempted.
    expect(fake.db.trendSnapshot.create).not.toHaveBeenCalled();
    expect(fake.db.trendSnapshot.findMany).not.toHaveBeenCalled();
    expect(fake.db.trendSnapshot.count).not.toHaveBeenCalled();
    expect(fake.db.trendSnapshot.aggregate).not.toHaveBeenCalled();
    expect(fake.db.trendKeyword.upsert).not.toHaveBeenCalled();
    expect(fake.db.trendKeyword.findMany).not.toHaveBeenCalled();
    expect(fake.db.trendCategory.upsert).not.toHaveBeenCalled();
    expect(fake.db.trendCategory.findMany).not.toHaveBeenCalled();
  });

  it("createSnapshot injects organizationId into the persisted data", async () => {
    const created = await repository.createSnapshot(ORG_A, snapshotDTO());
    expect(created.organizationId).toBe(ORG_A);
    expect(fake.snapshots).toHaveLength(1);
    expect(fake.snapshots[0]?.organizationId).toBe(ORG_A);
  });

  it("listSnapshots always scopes by organizationId, even with every filter active", async () => {
    await repository.createSnapshot(ORG_A, snapshotDTO({ keyword: "camisa masculina" }));
    await repository.createSnapshot(ORG_B, snapshotDTO({ keyword: "camisa masculina" }));

    const { items, total } = await repository.listSnapshots(
      ORG_A,
      query({ search: "camisa", category: "Moda", sort: "views", order: "desc" }),
    );

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]?.organizationId).toBe(ORG_A);
    // The where clause handed to Prisma carries the tenant scope.
    const where = fake.raw.trendSnapshot.findMany.mock.calls[0]?.[0]?.where;
    expect(where?.organizationId).toBe(ORG_A);
  });

  it("one tenant's snapshots are invisible to the other tenant", async () => {
    await repository.createSnapshot(ORG_A, snapshotDTO({ keyword: "bermuda cargo" }));
    await repository.createSnapshot(ORG_A, snapshotDTO({ keyword: "polo slim" }));
    await repository.createSnapshot(ORG_B, snapshotDTO({ keyword: "tênis chunky" }));

    const tenantA = await repository.listSnapshots(ORG_A, query());
    const tenantB = await repository.listSnapshots(ORG_B, query());

    expect(tenantA.total).toBe(2);
    expect(tenantB.total).toBe(1);
    expect(tenantB.items[0]?.keyword).toBe("tênis chunky");
  });

  it("topTrends only ranks the caller's tenant", async () => {
    await repository.createSnapshot(ORG_A, snapshotDTO({ keyword: "a-high", trendScore: 90 }));
    await repository.createSnapshot(ORG_B, snapshotDTO({ keyword: "b-high", trendScore: 99 }));

    const top = await repository.topTrends(ORG_A);
    expect(top).toHaveLength(1);
    expect(top[0]?.keyword).toBe("a-high");
  });

  it("stats aggregate only the caller's tenant", async () => {
    await repository.createSnapshot(ORG_A, snapshotDTO({ trendScore: 70 }));
    await repository.createSnapshot(ORG_A, snapshotDTO({ keyword: "polo slim", trendScore: 95 }));
    await repository.createSnapshot(
      ORG_B,
      snapshotDTO({ keyword: "tênis chunky", trendScore: 99 }),
    );
    await repository.upsertKeyword(ORG_A, "camisa masculina", 1);
    await repository.upsertKeyword(ORG_B, "tênis chunky", 1);
    await repository.upsertCategory(ORG_A, "Moda", 82);
    await repository.upsertCategory(ORG_B, "Street", 99);

    const stats = await repository.stats(ORG_A);
    expect(stats.totalSnapshots).toBe(2);
    expect(stats.maxScore).toBe(95);
    expect(stats.keywordCount).toBe(1);
    expect(stats.categoryCount).toBe(1);
    expect(stats.lastCollectedAt).toBeInstanceOf(Date);
  });

  it("findKeywords / findCategories stay tenant-scoped", async () => {
    await repository.upsertKeyword(ORG_A, "camisa masculina", 3);
    await repository.upsertKeyword(ORG_B, "camisa masculina", 9);
    await repository.upsertCategory(ORG_A, "Moda", 80);
    await repository.upsertCategory(ORG_B, "Moda", 91);

    const keywordsA = await repository.findKeywords(ORG_A);
    expect(keywordsA).toHaveLength(1);
    expect(keywordsA[0]?.frequency).toBe(3);

    const categoriesA = await repository.findCategories(ORG_A);
    expect(categoriesA).toHaveLength(1);
    expect(categoriesA[0]?.score).toBe(80);
  });

  it("upsertKeyword keys are tenant-scoped (same keyword, independent rows)", async () => {
    const inA = await repository.upsertKeyword(ORG_A, "camisa masculina", 1);
    const inB = await repository.upsertKeyword(ORG_B, "camisa masculina", 1);
    expect(inA.id).not.toBe(inB.id);

    const again = await repository.upsertKeyword(ORG_A, "camisa masculina", 2);
    expect(again.id).toBe(inA.id);
    expect(again.frequency).toBe(3); // 1 + 2
    expect(fake.keywords).toHaveLength(2);
  });

  it("upsertCategory refreshes the score in place", async () => {
    const first = await repository.upsertCategory(ORG_A, "Moda", 60);
    const second = await repository.upsertCategory(ORG_A, "Moda", 84);
    expect(second.id).toBe(first.id);
    expect(second.score).toBe(84);
    expect(fake.categories).toHaveLength(1);
  });
});

describe("trendRepository — listing behaviour", () => {
  let fake: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createTrendRepository>;

  beforeEach(async () => {
    fake = createFakeDb();
    repository = createTrendRepository(fake.db);

    const seeds: CreateTrendDTO[] = [
      snapshotDTO({
        keyword: "camisa masculina",
        category: "Moda",
        views: 500_000,
        likes: 90_000,
        trendScore: 72,
      }),
      snapshotDTO({
        keyword: "jaqueta premium",
        category: "Moda",
        views: 900_000,
        likes: 150_000,
        trendScore: 92,
      }),
      snapshotDTO({
        keyword: "bermuda cargo",
        category: "Casual",
        views: 700_000,
        likes: 120_000,
        trendScore: 89,
      }),
      snapshotDTO({
        keyword: "polo slim",
        category: "Casual",
        views: 300_000,
        likes: 60_000,
        trendScore: 75,
      }),
      snapshotDTO({
        keyword: "regata fitness",
        category: "Fitness",
        views: 800_000,
        likes: 140_000,
        trendScore: 88,
      }),
    ];
    for (const seed of seeds) {
      await repository.createSnapshot(ORG_A, seed);
    }
  });

  it("paginates with skip/take derived from page and pageSize", async () => {
    const page1 = await repository.listSnapshots(ORG_A, query({ page: "1", pageSize: "2" }));
    const page2 = await repository.listSnapshots(ORG_A, query({ page: "2", pageSize: "2" }));

    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page2.items.map((item) => item.keyword)).not.toEqual(
      page1.items.map((item) => item.keyword),
    );

    const call = fake.raw.trendSnapshot.findMany.mock.calls[0]?.[0];
    expect(call?.skip).toBe(0);
    expect(call?.take).toBe(2);
  });

  it("sorts by trendScore desc by default (top trends first)", async () => {
    const { items } = await repository.listSnapshots(ORG_A, query());
    const scores = items.map((item) => item.trendScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("sorts ascending when requested", async () => {
    const { items } = await repository.listSnapshots(ORG_A, query({ sort: "views", order: "asc" }));
    expect(items.map((item) => item.views)).toEqual([300_000, 500_000, 700_000, 800_000, 900_000]);
  });

  it("searches keywords case-insensitively", async () => {
    const { items, total } = await repository.listSnapshots(ORG_A, query({ search: "CAMISA" }));
    expect(total).toBe(1);
    expect(items[0]?.keyword).toBe("camisa masculina");
  });

  it("filters by category", async () => {
    const { items, total } = await repository.listSnapshots(ORG_A, query({ category: "Casual" }));
    expect(total).toBe(2);
    expect(items.every((item) => item.category === "Casual")).toBe(true);
  });

  it("combines search and category filter", async () => {
    const { total } = await repository.listSnapshots(
      ORG_A,
      query({ search: "slim", category: "Casual" }),
    );
    expect(total).toBe(1); // "polo slim"
  });
});

describe("trendRepository — topTrends options", () => {
  let repository: ReturnType<typeof createTrendRepository>;

  beforeEach(async () => {
    const fake = createFakeDb();
    repository = createTrendRepository(fake.db);
    const seeds: Array<[string, string, number]> = [
      ["camisa masculina", "Moda", 72],
      ["jaqueta premium", "Moda", 92],
      ["bermuda cargo", "Casual", 89],
      ["polo slim", "Casual", 75],
      ["regata fitness", "Fitness", 88],
    ];
    for (const [keyword, category, trendScore] of seeds) {
      await repository.createSnapshot(ORG_A, snapshotDTO({ keyword, category, trendScore }));
    }
  });

  it("returns the top N by score (default 10)", async () => {
    const top = await repository.topTrends(ORG_A);
    expect(top.map((trend) => trend.keyword)).toEqual([
      "jaqueta premium",
      "bermuda cargo",
      "regata fitness",
      "polo slim",
      "camisa masculina",
    ]);
  });

  it("honours a custom limit", async () => {
    const top = await repository.topTrends(ORG_A, { limit: 2 });
    expect(top).toHaveLength(2);
    expect(top[0]?.trendScore).toBe(92);
  });

  it("filters by category and minimum score", async () => {
    const casual = await repository.topTrends(ORG_A, { category: "Casual" });
    expect(casual).toHaveLength(2);

    const strong = await repository.topTrends(ORG_A, { minScore: 80 });
    expect(strong.every((trend) => trend.trendScore >= 80)).toBe(true);
    expect(strong).toHaveLength(3);
  });
});

describe("trendRepository — findKeywords options", () => {
  it("orders by frequency desc and supports search + limit", async () => {
    const fake = createFakeDb();
    const repository = createTrendRepository(fake.db);

    await repository.upsertKeyword(ORG_A, "camisa masculina", 5);
    await repository.upsertKeyword(ORG_A, "polo slim", 2);
    await repository.upsertKeyword(ORG_A, "jaqueta premium", 9);
    await repository.upsertKeyword(ORG_A, "regata fitness", 7);

    const all = await repository.findKeywords(ORG_A);
    expect(all.map((keyword) => keyword.keyword)).toEqual([
      "jaqueta premium",
      "regata fitness",
      "camisa masculina",
      "polo slim",
    ]);

    const searched = await repository.findKeywords(ORG_A, { search: "CAMISA" });
    expect(searched.map((keyword) => keyword.keyword)).toEqual(["camisa masculina"]);

    const limited = await repository.findKeywords(ORG_A, { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.keyword).toBe("jaqueta premium");
  });
});

// ------------------------------------------------------------------
// PR002.1 — source filter (listSnapshots)
// ------------------------------------------------------------------

describe("trendRepository — source filter (PR002.1)", () => {
  let fake: ReturnType<typeof createFakeDb>;
  let repository: ReturnType<typeof createTrendRepository>;

  beforeEach(async () => {
    fake = createFakeDb();
    repository = createTrendRepository(fake.db);

    const seeds: CreateTrendDTO[] = [
      snapshotDTO({
        keyword: "camisa masculina",
        category: "Moda",
        source: TrendSource.MOCK,
        trendScore: 72,
      }),
      snapshotDTO({
        keyword: "jaqueta premium",
        category: "Moda",
        source: TrendSource.TIKTOK,
        trendScore: 92,
      }),
      snapshotDTO({
        keyword: "bermuda cargo",
        category: "Casual",
        source: TrendSource.SHOPEE,
        trendScore: 89,
      }),
      snapshotDTO({
        keyword: "polo slim",
        category: "Casual",
        source: TrendSource.MANUAL,
        trendScore: 75,
      }),
      snapshotDTO({
        keyword: "regata fitness",
        category: "Fitness",
        source: TrendSource.MOCK,
        trendScore: 88,
      }),
    ];
    for (const seed of seeds) {
      await repository.createSnapshot(ORG_A, seed);
    }
    // Another tenant's MOCK row — must NEVER leak into ORG_A's results.
    await repository.createSnapshot(
      ORG_B,
      snapshotDTO({ keyword: "tênis chunky", source: TrendSource.MOCK }),
    );
  });

  it("returns only the snapshots of the requested source", async () => {
    const { items, total } = await repository.listSnapshots(ORG_A, query({ source: "MOCK" }));
    expect(total).toBe(2);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.source === "MOCK")).toBe(true);
  });

  it("every source is filterable (TIKTOK · SHOPEE · INSTAGRAM · MANUAL)", async () => {
    expect((await repository.listSnapshots(ORG_A, query({ source: "TIKTOK" }))).total).toBe(1);
    expect((await repository.listSnapshots(ORG_A, query({ source: "SHOPEE" }))).total).toBe(1);
    expect((await repository.listSnapshots(ORG_A, query({ source: "MANUAL" }))).total).toBe(1);
    // No INSTAGRAM snapshot was seeded — the filter simply returns nothing.
    expect((await repository.listSnapshots(ORG_A, query({ source: "INSTAGRAM" }))).total).toBe(0);
  });

  it("combines the source filter with the category filter", async () => {
    const { total, items } = await repository.listSnapshots(
      ORG_A,
      query({ source: "MOCK", category: "Moda" }),
    );
    expect(total).toBe(1); // "camisa masculina" — not "regata fitness"
    expect(items[0]?.keyword).toBe("camisa masculina");
  });

  it("combines the source filter with the search filter", async () => {
    const { total } = await repository.listSnapshots(
      ORG_A,
      query({ source: "MOCK", search: "regata" }),
    );
    expect(total).toBe(1);
  });

  it("no source filter returns every source (retrocompatible)", async () => {
    const { total } = await repository.listSnapshots(ORG_A, query());
    expect(total).toBe(5);
    const sources = new Set(
      (await repository.listSnapshots(ORG_A, query({ pageSize: "10" }))).items.map(
        (item) => item.source,
      ),
    );
    expect([...sources].sort()).toEqual(["MANUAL", "MOCK", "SHOPEE", "TIKTOK"]);
  });

  it("the source filter is tenant-scoped (another tenant's MOCK rows are invisible)", async () => {
    const { items, total } = await repository.listSnapshots(ORG_A, query({ source: "MOCK" }));
    expect(total).toBe(2);
    expect(items.some((item) => item.keyword === "tênis chunky")).toBe(false);
    // And the where clause carries both the tenant scope and the source.
    const where = fake.raw.trendSnapshot.findMany.mock.calls[0]?.[0]?.where;
    expect(where?.organizationId).toBe(ORG_A);
    expect(where?.source).toBe("MOCK");
  });

  it("createSnapshot persists an explicit source", async () => {
    const created = await repository.createSnapshot(
      ORG_A,
      snapshotDTO({ keyword: "mochila de academia", source: TrendSource.INSTAGRAM }),
    );
    expect(created.source).toBe(TrendSource.INSTAGRAM);
    expect(fake.snapshots[fake.snapshots.length - 1]?.source).toBe("INSTAGRAM");
  });

  it("createSnapshot without a source lets the database default (MOCK) apply", async () => {
    // Pre-PR002.1 callers send no source — Prisma's @default(MOCK) covers it.
    await repository.createSnapshot(ORG_A, snapshotDTO({ keyword: "camisa social slim" }));
    const data = fake.raw.trendSnapshot.create.mock.calls.at(-1)?.[0]?.data as Record<
      string,
      unknown
    >;
    expect("source" in data).toBe(false);
  });
});
