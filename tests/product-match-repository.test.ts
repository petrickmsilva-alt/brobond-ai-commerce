import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import {
  createProductMatchRepository,
  type ProductMatchDatabase,
} from "@/modules/campaigns/repositories/product-match.repository";
import { matchListQuerySchema } from "@/modules/campaigns/validators/product-match.validator";
import type { CreateProductMatchDTO } from "@/modules/campaigns/dto/product-match.dto";

/**
 * PR005.1 — Product Match repository, tested against an in-memory fake
 * Prisma.
 *
 * The repository is created through `createProductMatchRepository(db)`
 * exactly as production does — only the database is faked — so these
 * tests exercise the real tenant-isolation contract:
 *
 *   1. every query carries `organizationId`;
 *   2. a missing/blank tenant throws BEFORE any database call;
 *   3. one tenant can never read, approve, delete or aggregate another
 *      tenant's matches;
 *   4. a match between foreign content/product can never be created.
 *
 * (`@/lib/prisma` is mocked so importing the repository module does not
 * instantiate a PrismaClient in the test environment.)
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const ORG_A = "org_tenant_a";
const ORG_B = "org_tenant_b";

// ------------------------------------------------------------------
// In-memory fake Prisma (subset used by the product-match repository)
// ------------------------------------------------------------------

type AnyRow = Record<string, unknown>;

/** Prisma-`where` subset: equality · contains (insensitive) · OR · nested relations. */
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
        continue;
      }
      if ("in" in (value as object)) {
        if (!(value as { in: unknown[] }).in.includes(row[key])) return false;
        continue;
      }
      // Nested relation filter ({ externalContent: { title: { contains } } }).
      if (row[key] !== null && typeof row[key] === "object") {
        if (!matches(row[key] as AnyRow, value)) return false;
        continue;
      }
      if (row[key] !== value) return false;
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

interface ContentRow extends AnyRow {
  id: string;
  title: string;
  externalId: string;
  organizationId: string;
}

interface ProductRow extends AnyRow {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
}

interface MatchRow extends AnyRow {
  id: string;
  organizationId: string;
  externalContentId: string;
  productId: string;
  confidence: number;
  matchedBy: string;
  createdAt: Date;
  updatedAt: Date;
  externalContent: ContentRow;
  product: ProductRow;
}

function createFakeDatabase() {
  const contents: ContentRow[] = [];
  const products: ProductRow[] = [];
  const matchRows: MatchRow[] = [];
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${(sequence += 1)}`;
  let dbCalls = 0;
  const track = <T>(fn: () => T): T => {
    dbCalls += 1;
    return fn();
  };

  const attachRelations = (row: MatchRow): MatchRow => {
    row.externalContent = contents.find((c) => c.id === row.externalContentId) as ContentRow;
    row.product = products.find((p) => p.id === row.productId) as ProductRow;
    return row;
  };

  const untypedDb = {
    externalContent: {
      findFirst: async ({ where }: AnyRow = {}) =>
        track(() => rowsMatching(contents, where)[0] ?? null),
      count: async ({ where }: AnyRow = {}) => track(() => rowsMatching(contents, where).length),
    },
    product: {
      findFirst: async ({ where }: AnyRow = {}) =>
        track(() => rowsMatching(products, where)[0] ?? null),
    },
    productMatch: {
      findMany: async ({ where, orderBy, skip, take }: AnyRow = {}) =>
        track(() => {
          let rows = applyOrderBy(rowsMatching(matchRows, where), orderBy);
          const offset = (skip as number | undefined) ?? 0;
          const limit = take as number | null | undefined;
          if (limit !== undefined && limit !== null) rows = rows.slice(offset, offset + limit);
          else if (offset > 0) rows = rows.slice(offset);
          return rows;
        }),
      findFirst: async ({ where }: AnyRow = {}) =>
        track(() => rowsMatching(matchRows, where)[0] ?? null),
      count: async ({ where }: AnyRow = {}) => track(() => rowsMatching(matchRows, where).length),
      create: async ({ data }: AnyRow) =>
        track(() => {
          const row: MatchRow = {
            id: nextId("match"),
            confidence: 0,
            matchedBy: "RULE",
            createdAt: new Date(),
            updatedAt: new Date(),
            ...(data as AnyRow),
          } as MatchRow;
          matchRows.push(attachRelations(row));
          return { ...row };
        }),
      updateMany: async ({ where, data }: AnyRow) =>
        track(() => {
          const rows = rowsMatching(matchRows, where);
          for (const row of rows) {
            Object.assign(row, data, { updatedAt: new Date() });
          }
          return { count: rows.length };
        }),
      deleteMany: async ({ where }: AnyRow) =>
        track(() => {
          const rows = rowsMatching(matchRows, where);
          for (const row of rows) {
            const index = matchRows.indexOf(row);
            matchRows.splice(index, 1);
          }
          return { count: rows.length };
        }),
      groupBy: async ({ by, where }: AnyRow = {}) =>
        track(() => {
          const field = (by as string[])[0] as string;
          const groups = new Map<string, number>();
          for (const row of rowsMatching(matchRows, where)) {
            const key = String(row[field]);
            groups.set(key, (groups.get(key) ?? 0) + 1);
          }
          return [...groups.entries()].map(([value, count]) => ({
            [field]: value,
            _count: { _all: count },
          }));
        }),
      aggregate: async ({ where, _avg }: AnyRow = {}) =>
        track(() => {
          const rows = rowsMatching(matchRows, where);
          const result: AnyRow = {};
          if ((_avg as AnyRow | undefined)?.confidence !== undefined) {
            const total = rows.reduce((sum, row) => sum + (row.confidence as number), 0);
            result._avg = { confidence: rows.length === 0 ? null : total / rows.length };
          }
          return result;
        }),
    },
  };

  const db = untypedDb as unknown as ProductMatchDatabase;

  return {
    db,
    contents,
    products,
    matchRows,
    dbCallCount: () => dbCalls,
  };
}

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

const query = (overrides: Record<string, unknown> = {}) => matchListQuerySchema.parse(overrides);

const dto = (overrides: Partial<CreateProductMatchDTO> = {}): CreateProductMatchDTO => ({
  externalContentId: "content_a",
  productId: "product_a",
  confidence: 0.85,
  matchedBy: "RULE",
  ...overrides,
});

let fixture: ReturnType<typeof createFakeDatabase>;

beforeEach(() => {
  fixture = createFakeDatabase();
  const { contents, products, matchRows } = fixture;

  contents.push(
    {
      id: "content_a",
      title: "Hoodie Streetwear — video 001",
      externalId: "mock-video-001",
      organizationId: ORG_A,
    },
    {
      id: "content_b",
      title: "Jaqueta Premium — video 002",
      externalId: "mock-video-002",
      organizationId: ORG_A,
    },
    {
      id: "content_foreign",
      title: "Conteúdo de outro tenant",
      externalId: "other-001",
      organizationId: ORG_B,
    },
  );
  products.push(
    {
      id: "product_a",
      name: "Hoodie Streetwear",
      slug: "hoodie-streetwear",
      organizationId: ORG_A,
    },
    { id: "product_b", name: "Jaqueta Premium", slug: "jaqueta-premium", organizationId: ORG_A },
    {
      id: "product_foreign",
      name: "Produto de outro tenant",
      slug: "produto-foreign",
      organizationId: ORG_B,
    },
  );
  const now = new Date();
  matchRows.push(
    {
      id: "match_a1",
      organizationId: ORG_A,
      externalContentId: "content_a",
      productId: "product_a",
      confidence: 0.85,
      matchedBy: "AI",
      createdAt: now,
      updatedAt: now,
    } as MatchRow,
    {
      id: "match_a2",
      organizationId: ORG_A,
      externalContentId: "content_b",
      productId: "product_b",
      confidence: 0.65,
      matchedBy: "RULE",
      createdAt: now,
      updatedAt: now,
    } as MatchRow,
    {
      id: "match_a3",
      organizationId: ORG_A,
      externalContentId: "content_b",
      productId: "product_a",
      confidence: 0.55,
      matchedBy: "MANUAL",
      createdAt: now,
      updatedAt: now,
    } as MatchRow,
    {
      id: "match_foreign",
      organizationId: ORG_B,
      externalContentId: "content_foreign",
      productId: "product_foreign",
      confidence: 0.99,
      matchedBy: "MANUAL",
      createdAt: now,
      updatedAt: now,
    } as MatchRow,
  );
  for (const row of matchRows) {
    (row as MatchRow).externalContent = contents.find(
      (c) => c.id === row.externalContentId,
    ) as ContentRow;
    (row as MatchRow).product = products.find((p) => p.id === row.productId) as ProductRow;
  }
});

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("product-match repository · tenant injection", () => {
  it("injects the organization scope into every query it runs", async () => {
    const repo = createProductMatchRepository(fixture.db);
    await repo.listMatches(ORG_A, query());
    await repo.findByContent(ORG_A, "content_a");
    await repo.findByProduct(ORG_A, "product_a");
    await repo.kpis(ORG_A);
    await repo.createMatch(ORG_A, dto());
    await repo.approveMatch(ORG_A, "match_a2");
    await repo.deleteMatch(ORG_A, "match_a3");

    // Every persisted/queried row is tenant A — the foreign row is invisible.
    for (const row of fixture.matchRows) {
      if (row.id.startsWith("match_a")) expect(row.organizationId).toBe(ORG_A);
    }
    expect(fixture.matchRows.find((row) => row.id === "match_foreign")).toBeDefined();
  });

  it("throws BEFORE any database call when the tenant is blank", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const before = fixture.dbCallCount();

    await expect(repo.listMatches("", query())).rejects.toThrow(AuthorizationError);
    await expect(repo.listMatches("   ", query())).rejects.toThrow(AuthorizationError);
    await expect(repo.findByContent(null as unknown as string, "content_a")).rejects.toThrow(
      AuthorizationError,
    );
    await expect(repo.findByProduct(undefined as unknown as string, "product_a")).rejects.toThrow(
      AuthorizationError,
    );
    await expect(repo.createMatch("", dto())).rejects.toThrow(AuthorizationError);
    await expect(repo.approveMatch("", "match_a1")).rejects.toThrow(AuthorizationError);
    await expect(repo.deleteMatch("", "match_a1")).rejects.toThrow(AuthorizationError);
    await expect(repo.kpis("")).rejects.toThrow(AuthorizationError);

    expect(fixture.dbCallCount()).toBe(before); // zero database calls
  });
});

describe("product-match repository · cross-tenant invisibility", () => {
  it("lists only the caller's matches", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const { items, total } = await repo.listMatches(ORG_A, query());
    expect(total).toBe(3);
    expect(items.map((item) => item.id).sort()).toEqual(["match_a1", "match_a2", "match_a3"]);
  });

  it("finds no matches of another tenant's content", async () => {
    const repo = createProductMatchRepository(fixture.db);
    // Tenant B has a match on "content_foreign" — tenant A must not see it…
    expect(await repo.findByContent(ORG_A, "content_foreign")).toEqual([]);
    // …and tenant A's own content is invisible to tenant B.
    expect(await repo.findByContent(ORG_B, "content_a")).toEqual([]);
  });

  it("finds no matches of another tenant's product", async () => {
    const repo = createProductMatchRepository(fixture.db);
    expect(await repo.findByProduct(ORG_A, "product_foreign")).toEqual([]);
    expect(await repo.findByProduct(ORG_B, "product_a")).toEqual([]);
  });

  it("returns the endpoints (content + product) on every read", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const [match] = await repo.findByContent(ORG_A, "content_a");
    expect(match?.externalContent.title).toBe("Hoodie Streetwear — video 001");
    expect(match?.product.slug).toBe("hoodie-streetwear");
  });
});

describe("product-match repository · listMatches", () => {
  it("orders by confidence descending (the dashboard default sort)", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const { items } = await repo.listMatches(ORG_A, query());
    const confidences = items.map((item) => item.confidence);
    expect(confidences).toEqual([0.85, 0.65, 0.55]);
  });

  it("paginates with page/pageSize", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const page1 = await repo.listMatches(ORG_A, query({ page: 1, pageSize: 2 }));
    const page2 = await repo.listMatches(ORG_A, query({ page: 2, pageSize: 2 }));
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.id).toBe("match_a3");
  });

  it("searches by content title (case-insensitive)", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const byTitle = await repo.listMatches(ORG_A, query({ search: "video 001" }));
    expect(byTitle.total).toBe(1);
    expect(byTitle.items[0]?.id).toBe("match_a1");
    // The search is an OR across content title and product name/slug.
    const byEither = await repo.listMatches(ORG_A, query({ search: "hoodie streetwear" }));
    expect(byEither.total).toBe(2);
    expect(byEither.items.map((item) => item.id).sort()).toEqual(["match_a1", "match_a3"]);
  });

  it("searches by product name and slug", async () => {
    const repo = createProductMatchRepository(fixture.db);
    expect((await repo.listMatches(ORG_A, query({ search: "jaqueta premium" }))).total).toBe(2);
    expect((await repo.listMatches(ORG_A, query({ search: "produto de outro" }))).total).toBe(0);
  });
});

describe("product-match repository · createMatch", () => {
  it("creates a tenant-scoped match with both endpoints loaded", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const created = await repo.createMatch(ORG_A, dto({ confidence: 0.72, matchedBy: "MANUAL" }));
    expect(created).not.toBeNull();
    expect(created?.organizationId).toBe(ORG_A);
    expect(created?.externalContentId).toBe("content_a");
    expect(created?.productId).toBe("product_a");
    expect(created?.confidence).toBe(0.72);
    expect(created?.matchedBy).toBe("MANUAL");
    expect(created?.externalContent.id).toBe("content_a");
    expect(created?.product.id).toBe("product_a");
  });

  it("refuses content that belongs to another tenant (no write)", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const created = await repo.createMatch(ORG_A, dto({ externalContentId: "content_foreign" }));
    expect(created).toBeNull();
    expect(fixture.matchRows).toHaveLength(4); // nothing was written
  });

  it("refuses a product that belongs to another tenant (no write)", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const created = await repo.createMatch(ORG_A, dto({ productId: "product_foreign" }));
    expect(created).toBeNull();
    expect(fixture.matchRows).toHaveLength(4);
  });

  it("refuses unknown ids (no write)", async () => {
    const repo = createProductMatchRepository(fixture.db);
    expect(await repo.createMatch(ORG_A, dto({ externalContentId: "nope" }))).toBeNull();
    expect(await repo.createMatch(ORG_A, dto({ productId: "nope" }))).toBeNull();
    expect(fixture.matchRows).toHaveLength(4);
  });
});

describe("product-match repository · approveMatch", () => {
  it("promotes an automatic match to MANUAL with full confidence", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const approved = await repo.approveMatch(ORG_A, "match_a2");
    expect(approved?.matchedBy).toBe("MANUAL");
    expect(approved?.confidence).toBe(1);
    expect(approved?.id).toBe("match_a2");
  });

  it("never touches another tenant's match", async () => {
    const repo = createProductMatchRepository(fixture.db);
    expect(await repo.approveMatch(ORG_A, "match_foreign")).toBeNull();
    const foreign = fixture.matchRows.find((row) => row.id === "match_foreign");
    expect(foreign?.matchedBy).toBe("MANUAL"); // untouched
    expect(foreign?.confidence).toBe(0.99);
  });

  it("returns null for an unknown id", async () => {
    const repo = createProductMatchRepository(fixture.db);
    expect(await repo.approveMatch(ORG_A, "nope")).toBeNull();
  });
});

describe("product-match repository · deleteMatch", () => {
  it("deletes a tenant-scoped match and reports it", async () => {
    const repo = createProductMatchRepository(fixture.db);
    expect(await repo.deleteMatch(ORG_A, "match_a3")).toBe(true);
    expect(fixture.matchRows.find((row) => row.id === "match_a3")).toBeUndefined();
  });

  it("cannot delete another tenant's match", async () => {
    const repo = createProductMatchRepository(fixture.db);
    expect(await repo.deleteMatch(ORG_A, "match_foreign")).toBe(false);
    expect(await repo.deleteMatch(ORG_B, "match_a1")).toBe(false);
    expect(fixture.matchRows).toHaveLength(4);
  });
});

describe("product-match repository · kpis", () => {
  it("aggregates sources, averages confidence and counts distinct contents", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const kpis = await repo.kpis(ORG_A);
    expect(kpis.importedContents).toBe(2); // contents of tenant A only
    expect(kpis.totalMatches).toBe(3);
    expect(kpis.automaticMatches).toBe(2); // AI + RULE
    expect(kpis.manualMatches).toBe(1);
    expect(kpis.matchedContents).toBe(2); // content_a + content_b
    expect(kpis.averageConfidence).toBeCloseTo((0.85 + 0.65 + 0.55) / 3, 10);
  });

  it("ignores the other tenant's rows entirely", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const kpisB = await repo.kpis(ORG_B);
    expect(kpisB.totalMatches).toBe(1);
    expect(kpisB.importedContents).toBe(1);
    expect(kpisB.matchedContents).toBe(1);
    expect(kpisB.automaticMatches).toBe(0);
    expect(kpisB.manualMatches).toBe(1);
  });

  it("returns zeros for an empty tenant (no division by zero)", async () => {
    const repo = createProductMatchRepository(fixture.db);
    const kpis = await repo.kpis("org_empty");
    expect(kpis).toEqual({
      importedContents: 0,
      totalMatches: 0,
      automaticMatches: 0,
      manualMatches: 0,
      matchedContents: 0,
      averageConfidence: 0,
    });
  });
});
