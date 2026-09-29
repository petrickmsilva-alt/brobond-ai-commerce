import { describe, expect, it } from "vitest";
import { MatchSource } from "@prisma/client";
import {
  MATCH_SOURCES,
  MATCH_SOURCE_LABELS,
  MATCH_STATUSES,
  MATCH_STATUS_LABELS,
  AUTOMATIC_MATCH_SOURCES,
  matchStatusFromSource,
  type MatchSourceName,
} from "@/modules/campaigns/matching/match-source";
import {
  MATCH_PAGE_SIZE_DEFAULT,
  approveProductMatchSchema,
  createProductMatchSchema,
  matchConfidenceSchema,
  matchListQuerySchema,
  matchSourceSchema,
  removeProductMatchSchema,
} from "@/modules/campaigns/validators/product-match.validator";
import {
  toProductMatchItemDTO,
  toProductMatchKpisDTO,
  toProductMatchPageDTO,
  type ProductMatchRow,
} from "@/modules/campaigns/dto/product-match.dto";

/**
 * PR005.1 — DTOs, validators and client-safe mirrors.
 *
 * The Zod schemas are the single source of truth for every write path:
 * `organizationId` is never accepted from the client (it is not even a
 * field), confidence is validated against the 0–1 range and the enum
 * mirror must stay in sync with the Prisma `MatchSource`.
 */

const validPayload = {
  externalContentId: "content_123",
  productId: "product_456",
  confidence: 0.85,
  matchedBy: "RULE",
};

describe("MatchSource mirror", () => {
  it("stays in sync with the Prisma enum", () => {
    expect([...MATCH_SOURCES].sort()).toEqual(Object.values(MatchSource).sort());
  });

  it("labels every source", () => {
    for (const source of MATCH_SOURCES) {
      expect(MATCH_SOURCE_LABELS[source].length).toBeGreaterThan(0);
    }
  });

  it("treats exactly AI and RULE as automatic origins", () => {
    expect(AUTOMATIC_MATCH_SOURCES).toEqual(["AI", "RULE"]);
  });
});

describe("matchStatusFromSource", () => {
  it("labels every status", () => {
    for (const status of MATCH_STATUSES) {
      expect(MATCH_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it("derives APROVADO from MANUAL (human-curated = approved)", () => {
    expect(matchStatusFromSource("MANUAL")).toBe("APROVADO");
    expect(matchStatusFromSource(MatchSource.MANUAL)).toBe("APROVADO");
  });

  it("derives PENDENTE from the automatic origins (awaiting review)", () => {
    expect(matchStatusFromSource("AI")).toBe("PENDENTE");
    expect(matchStatusFromSource("RULE")).toBe("PENDENTE");
  });
});

describe("matchSourceSchema", () => {
  it("accepts every origin", () => {
    for (const source of MATCH_SOURCES) {
      expect(matchSourceSchema.parse(source)).toBe(source);
    }
  });

  it("rejects unknown origins", () => {
    expect(matchSourceSchema.safeParse("GUEST").success).toBe(false);
    expect(matchSourceSchema.safeParse("").success).toBe(false);
    expect(matchSourceSchema.safeParse(1).success).toBe(false);
  });
});

describe("matchConfidenceSchema", () => {
  it("accepts the 0–1 range inclusive", () => {
    expect(matchConfidenceSchema.parse(0)).toBe(0);
    expect(matchConfidenceSchema.parse(1)).toBe(1);
    expect(matchConfidenceSchema.parse(0.55)).toBe(0.55);
  });

  it("rejects anything below 0 or above 1", () => {
    expect(matchConfidenceSchema.safeParse(-0.01).success).toBe(false);
    expect(matchConfidenceSchema.safeParse(1.01).success).toBe(false);
    expect(matchConfidenceSchema.safeParse(42).success).toBe(false);
  });

  it("rejects non-numbers and non-finite values", () => {
    expect(matchConfidenceSchema.safeParse("0.5").success).toBe(false);
    expect(matchConfidenceSchema.safeParse(Number.NaN).success).toBe(false);
    expect(matchConfidenceSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it("rounds to two decimals on parse", () => {
    expect(matchConfidenceSchema.parse(0.554)).toBe(0.55);
    expect(matchConfidenceSchema.parse(0.987)).toBe(0.99);
  });
});

describe("createProductMatchSchema", () => {
  it("parses a valid payload", () => {
    expect(createProductMatchSchema.parse(validPayload)).toEqual(validPayload);
  });

  it("requires all four fields", () => {
    for (const key of ["externalContentId", "productId", "confidence", "matchedBy"] as const) {
      const rest: Record<string, unknown> = { ...validPayload };
      delete rest[key];
      expect(createProductMatchSchema.safeParse(rest).success).toBe(false);
    }
  });

  it("trims the ids", () => {
    const parsed = createProductMatchSchema.parse({
      ...validPayload,
      externalContentId: "  content_123  ",
      productId: " product_456 ",
    });
    expect(parsed.externalContentId).toBe("content_123");
    expect(parsed.productId).toBe("product_456");
  });

  it("rejects a hostile client-supplied organizationId (not part of the schema)", () => {
    const parsed = createProductMatchSchema.safeParse({
      ...validPayload,
      organizationId: "org_attacker",
    });
    // Zod strips unknown keys by default — the tenant can never be spoofed.
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("organizationId");
    }
  });

  it("rejects invalid matchedBy", () => {
    expect(
      createProductMatchSchema.safeParse({ ...validPayload, matchedBy: "GUESS" }).success,
    ).toBe(false);
  });
});

describe("approve/remove schemas", () => {
  it("accept and trim a match id", () => {
    expect(approveProductMatchSchema.parse({ matchId: " match_1 " })).toEqual({
      matchId: "match_1",
    });
    expect(removeProductMatchSchema.parse({ matchId: "match_1" })).toEqual({ matchId: "match_1" });
  });

  it("reject an empty or missing id", () => {
    expect(approveProductMatchSchema.safeParse({ matchId: "" }).success).toBe(false);
    expect(approveProductMatchSchema.safeParse({}).success).toBe(false);
    expect(removeProductMatchSchema.safeParse({ matchId: "   " }).success).toBe(false);
  });
});

describe("matchListQuerySchema", () => {
  it("falls back to safe defaults", () => {
    expect(matchListQuerySchema.parse({})).toEqual({
      search: undefined,
      page: 1,
      pageSize: MATCH_PAGE_SIZE_DEFAULT,
    });
  });

  it("recovers from malformed pagination (never a 500)", () => {
    expect(matchListQuerySchema.parse({ page: "abc" }).page).toBe(1);
    expect(matchListQuerySchema.parse({ pageSize: "9999" }).pageSize).toBe(MATCH_PAGE_SIZE_DEFAULT);
    expect(matchListQuerySchema.parse({ page: "-3" }).page).toBe(1);
  });

  it("trims the search and collapses it to undefined when empty", () => {
    expect(matchListQuerySchema.parse({ search: "  hoodie  " }).search).toBe("hoodie");
    expect(matchListQuerySchema.parse({ search: "   " }).search).toBeUndefined();
  });
});

describe("toProductMatchItemDTO", () => {
  const row = {
    id: "match_1",
    organizationId: "org_1",
    externalContentId: "content_1",
    productId: "product_1",
    confidence: 0.85,
    matchedBy: "AI",
    createdAt: new Date("2026-09-23T12:00:00.000Z"),
    updatedAt: new Date("2026-09-23T12:00:00.000Z"),
    externalContent: {
      id: "content_1",
      title: "Hoodie Streetwear — video 001",
      externalId: "mock-video-001",
      platform: "MOCK",
      type: "VIDEO",
      url: "https://mock.brobond.local/video/001",
    },
    product: { id: "product_1", name: "Hoodie Streetwear", slug: "hoodie-streetwear" },
  } as unknown as ProductMatchRow;

  it("serializes dates as ISO strings across the RSC boundary", () => {
    const dto = toProductMatchItemDTO(row);
    expect(dto.createdAt).toBe("2026-09-23T12:00:00.000Z");
  });

  it("flattens the endpoints into content/product views", () => {
    const dto = toProductMatchItemDTO(row);
    expect(dto.content.title).toBe("Hoodie Streetwear — video 001");
    expect(dto.product.slug).toBe("hoodie-streetwear");
    expect(dto.confidence).toBe(0.85);
    expect(dto.matchedBy).toBe("AI");
  });

  it("derives the status from the origin", () => {
    expect(toProductMatchItemDTO(row).status).toBe("PENDENTE");
    const manual = toProductMatchItemDTO({ ...row, matchedBy: "MANUAL" } as ProductMatchRow);
    expect(manual.status).toBe("APROVADO");
  });

  it("carries no tenant id (the DTO is the client-safe boundary)", () => {
    const dto = toProductMatchItemDTO(row);
    expect(dto).not.toHaveProperty("organizationId");
  });
});

describe("toProductMatchKpisDTO", () => {
  it("maps the aggregates and derives the pending backlog", () => {
    const kpis = toProductMatchKpisDTO({
      importedContents: 36,
      totalMatches: 50,
      automaticMatches: 40,
      manualMatches: 10,
      matchedContents: 30,
      averageConfidence: 0.72666,
    });
    expect(kpis.importedContents).toBe(36);
    expect(kpis.automaticMatches).toBe(40);
    expect(kpis.manualMatches).toBe(10);
    expect(kpis.totalMatches).toBe(50);
    expect(kpis.pendingContents).toBe(6); // 36 imported − 30 matched
    expect(kpis.averageConfidence).toBe(0.73); // rounded to 2 decimals
  });

  it("never reports a negative pending backlog", () => {
    const kpis = toProductMatchKpisDTO({
      importedContents: 5,
      totalMatches: 3,
      automaticMatches: 3,
      manualMatches: 0,
      matchedContents: 9, // matches can reference contents other dashboards count differently
      averageConfidence: 0.5,
    });
    expect(kpis.pendingContents).toBe(0);
  });

  it("handles an empty workspace", () => {
    const kpis = toProductMatchKpisDTO({
      importedContents: 0,
      totalMatches: 0,
      automaticMatches: 0,
      manualMatches: 0,
      matchedContents: 0,
      averageConfidence: 0,
    });
    expect(kpis.pendingContents).toBe(0);
    expect(kpis.averageConfidence).toBe(0);
  });
});

describe("toProductMatchPageDTO", () => {
  it("computes the total pages (at least one)", () => {
    expect(toProductMatchPageDTO([], 1, 10, 0).totalPages).toBe(1);
    expect(toProductMatchPageDTO([], 1, 10, 45).totalPages).toBe(5);
  });

  it("keeps the pagination envelope", () => {
    const page = toProductMatchPageDTO(
      [
        toProductMatchItemDTO({
          id: "m",
          confidence: 1,
          matchedBy: "RULE",
          createdAt: new Date(0),
          updatedAt: new Date(0),
          externalContentId: "c",
          productId: "p",
          organizationId: "o",
          externalContent: {
            id: "c",
            title: "t",
            externalId: "e",
            platform: "MOCK",
            type: "VIDEO",
            url: null,
          },
          product: { id: "p", name: "n", slug: "s" },
        } as unknown as ProductMatchRow),
      ],
      2,
      10,
      11,
    );
    expect(page).toMatchObject({ page: 2, pageSize: 10, total: 11, totalPages: 2 });
    expect(page.items).toHaveLength(1);
  });
});

describe("server-action result contract", () => {
  it("types the success and failure branches", () => {
    const success: { ok: true; data: { id: string } } = { ok: true, data: { id: "m1" } };
    const failure: { ok: false; error: string } = { ok: false, error: "nope" };
    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
  });
});
