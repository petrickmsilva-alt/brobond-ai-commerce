import { describe, expect, it } from "vitest";
import {
  CREATOR_PAGE_SIZE_DEFAULT,
  CREATOR_PAGE_SIZE_MAX,
  CREATOR_STATUSES,
  creatorCandidateSchema,
  createCreatorSchema,
  changeCreatorStatusSchema,
  creatorListQuerySchema,
  normalizeHandle,
  updateCreatorSchema,
} from "@/modules/creators/crm/validators/creator.validator";

/**
 * PR003 — creators-module validators & handle canonicalization.
 *
 * `organizationId` is never part of any schema: the tenant always comes
 * from the session. Hostile inputs (unknown sort fields, invalid niches,
 * injected tenant ids) must fall back or be stripped.
 */

const VALID_CANDIDATE = {
  externalId: "mock-moda-001",
  handle: "@ana.souza001",
  displayName: "Ana Souza",
  niche: "Moda",
  followers: 250_000,
  avgViews: 90_000,
  engagementRate: 7.5,
  postsPerWeek: 4,
  growthRate: 10,
  qualityScore: 80,
  tags: ["moda masculina"],
};

describe("normalizeHandle", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeHandle("  Ana   Souza ")).toBe("@ana souza");
  });

  it("guarantees exactly one leading @", () => {
    expect(normalizeHandle("ana.souza")).toBe("@ana.souza");
    expect(normalizeHandle("@ana.souza")).toBe("@ana.souza");
    expect(normalizeHandle("@@@ana.souza")).toBe("@ana.souza");
    expect(normalizeHandle("  @Ana.Souza ")).toBe("@ana.souza");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeHandle("")).toBe("");
    expect(normalizeHandle("   ")).toBe("");
    expect(normalizeHandle("@")).toBe("");
  });
});

describe("creatorCandidateSchema", () => {
  it("accepts a valid candidate", () => {
    expect(creatorCandidateSchema.parse(VALID_CANDIDATE)).toEqual(VALID_CANDIDATE);
  });

  it("canonicalizes the handle on parse", () => {
    const parsed = creatorCandidateSchema.parse({ ...VALID_CANDIDATE, handle: "@Ana.Souza001" });
    expect(parsed.handle).toBe("@ana.souza001");
  });

  it("rejects an unknown niche", () => {
    expect(() => creatorCandidateSchema.parse({ ...VALID_CANDIDATE, niche: "Pet" })).toThrowError(
      /Nicho inválido/,
    );
  });

  it("rejects blank/missing externalId", () => {
    expect(() => creatorCandidateSchema.parse({ ...VALID_CANDIDATE, externalId: "" })).toThrow();
    expect(() =>
      creatorCandidateSchema.parse({ ...VALID_CANDIDATE, externalId: undefined }),
    ).toThrow();
  });

  it("rejects negative or fractional counts", () => {
    expect(() => creatorCandidateSchema.parse({ ...VALID_CANDIDATE, followers: -1 })).toThrow();
    expect(() => creatorCandidateSchema.parse({ ...VALID_CANDIDATE, avgViews: 1.5 })).toThrow();
  });

  it("rejects engagement/quality outside 0–100", () => {
    expect(() =>
      creatorCandidateSchema.parse({ ...VALID_CANDIDATE, engagementRate: 101 }),
    ).toThrow();
    expect(() => creatorCandidateSchema.parse({ ...VALID_CANDIDATE, qualityScore: -1 })).toThrow();
  });

  it("allows growth above 100% (small accounts go viral)", () => {
    expect(() =>
      creatorCandidateSchema.parse({ ...VALID_CANDIDATE, growthRate: 250 }),
    ).not.toThrow();
    expect(() =>
      creatorCandidateSchema.parse({ ...VALID_CANDIDATE, growthRate: 10_001 }),
    ).toThrow();
  });

  it("rejects a too-short display name", () => {
    expect(() => creatorCandidateSchema.parse({ ...VALID_CANDIDATE, displayName: "A" })).toThrow();
  });

  it("rejects more than 10 tags", () => {
    expect(() =>
      creatorCandidateSchema.parse({
        ...VALID_CANDIDATE,
        tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
      }),
    ).toThrow();
  });

  it("strips unknown keys — a client-supplied organizationId never survives", () => {
    const parsed = creatorCandidateSchema.parse({
      ...VALID_CANDIDATE,
      organizationId: "org_attacker",
      creatorScore: 99,
      isAdmin: true,
    }) as Record<string, unknown>;
    expect(parsed.organizationId).toBeUndefined();
    expect(parsed.creatorScore).toBeUndefined();
    expect(parsed.isAdmin).toBeUndefined();
  });
});

describe("createCreatorSchema (manual CRM creation)", () => {
  const VALID_FORM = {
    handle: "@novo.creator",
    displayName: "Novo Creator",
    niche: "Street",
  };

  it("applies zero defaults for omitted metrics", () => {
    const parsed = createCreatorSchema.parse(VALID_FORM);
    expect(parsed.followers).toBe(0);
    expect(parsed.avgViews).toBe(0);
    expect(parsed.engagementRate).toBe(0);
  });

  it("canonicalizes the handle and lowercases the email", () => {
    const parsed = createCreatorSchema.parse({
      ...VALID_FORM,
      handle: "Novo.Creator",
      email: "Novo@Creator.COM",
    });
    expect(parsed.handle).toBe("@novo.creator");
    expect(parsed.email).toBe("novo@creator.com");
  });

  it("rejects an invalid email", () => {
    expect(() => createCreatorSchema.parse({ ...VALID_FORM, email: "not-an-email" })).toThrow();
  });

  it("rejects an invalid avatar URL", () => {
    expect(() => createCreatorSchema.parse({ ...VALID_FORM, avatarUrl: "not-a-url" })).toThrow();
  });

  it("accepts tags and caps them at 10", () => {
    expect(createCreatorSchema.parse({ ...VALID_FORM, tags: ["a", "b"] }).tags).toEqual(["a", "b"]);
    expect(() =>
      createCreatorSchema.parse({
        ...VALID_FORM,
        tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
      }),
    ).toThrow();
  });

  it("strips a client-supplied status/source/organizationId", () => {
    const parsed = createCreatorSchema.parse({
      ...VALID_FORM,
      status: "ACTIVE",
      source: "TIKTOK",
      organizationId: "org_attacker",
    }) as Record<string, unknown>;
    expect(parsed.status).toBeUndefined();
    expect(parsed.source).toBeUndefined();
    expect(parsed.organizationId).toBeUndefined();
  });
});

describe("updateCreatorSchema", () => {
  it("accepts a partial update", () => {
    const parsed = updateCreatorSchema.parse({ displayName: "Nome Novo" });
    expect(parsed).toEqual({ displayName: "Nome Novo" });
  });

  it("accepts an empty update (no-op)", () => {
    expect(updateCreatorSchema.parse({})).toEqual({});
  });

  it("rejects an invalid niche", () => {
    expect(() => updateCreatorSchema.parse({ niche: "Pet" })).toThrow();
  });

  it("rejects an invalid email", () => {
    expect(() => updateCreatorSchema.parse({ email: "nope" })).toThrow();
  });
});

describe("changeCreatorStatusSchema", () => {
  it("accepts a valid move", () => {
    expect(changeCreatorStatusSchema.parse({ id: "c1", status: "QUALIFIED" })).toEqual({
      id: "c1",
      status: "QUALIFIED",
    });
  });

  it("rejects every non-pipeline status", () => {
    for (const status of ["PROSPECT", "INVITED", "PAUSED", "DELETED", ""]) {
      expect(() => changeCreatorStatusSchema.parse({ id: "c1", status })).toThrow();
    }
  });

  it("rejects a missing id", () => {
    expect(() => changeCreatorStatusSchema.parse({ status: "ACTIVE" })).toThrow();
  });

  it("accepts all six pipeline statuses", () => {
    for (const status of CREATOR_STATUSES) {
      expect(changeCreatorStatusSchema.parse({ id: "c1", status }).status).toBe(status);
    }
  });
});

describe("creatorListQuerySchema (dashboard URL state)", () => {
  it("has safe defaults (page 1 · top score first)", () => {
    const query = creatorListQuerySchema.parse({});
    expect(query).toEqual({
      page: 1,
      pageSize: CREATOR_PAGE_SIZE_DEFAULT,
      search: undefined,
      status: undefined,
      niche: undefined,
      source: undefined,
      sort: "creatorScore",
      order: "desc",
    });
  });

  it("coerces numeric strings coming from the URL", () => {
    const query = creatorListQuerySchema.parse({ page: "2", pageSize: "25" });
    expect(query.page).toBe(2);
    expect(query.pageSize).toBe(25);
  });

  it("falls back to page 1 on invalid input", () => {
    expect(creatorListQuerySchema.parse({ page: "abc" }).page).toBe(1);
    expect(creatorListQuerySchema.parse({ page: "-3" }).page).toBe(1);
  });

  it("falls back to the default page size on out-of-range values", () => {
    expect(creatorListQuerySchema.parse({ pageSize: "500" }).pageSize).toBe(
      CREATOR_PAGE_SIZE_DEFAULT,
    );
    expect(creatorListQuerySchema.parse({ pageSize: "0" }).pageSize).toBe(
      CREATOR_PAGE_SIZE_DEFAULT,
    );
    expect(creatorListQuerySchema.parse({ pageSize: String(CREATOR_PAGE_SIZE_MAX) }).pageSize).toBe(
      CREATOR_PAGE_SIZE_MAX,
    );
  });

  it("falls back to the default sort/order on unknown values", () => {
    const query = creatorListQuerySchema.parse({ sort: "password", order: "sideways" });
    expect(query.sort).toBe("creatorScore");
    expect(query.order).toBe("desc");
  });

  it("falls back to no filter on invalid status/niche/source", () => {
    const query = creatorListQuerySchema.parse({ status: "PROSPECT", niche: "Pet", source: "X" });
    expect(query.status).toBeUndefined();
    expect(query.niche).toBeUndefined();
    expect(query.source).toBeUndefined();
  });

  it("trims the free-text search", () => {
    expect(creatorListQuerySchema.parse({ search: "  ana  " }).search).toBe("ana");
  });

  it("drops an over-long search", () => {
    expect(creatorListQuerySchema.parse({ search: "x".repeat(200) }).search).toBeUndefined();
  });
});
