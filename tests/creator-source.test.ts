import { describe, expect, it } from "vitest";
import { CreatorSource, CreatorStatus } from "@prisma/client";
import {
  CREATOR_SOURCES,
  CREATOR_STATUSES,
  CREATOR_STATUS_LABELS,
  DEFAULT_CREATOR_SOURCE,
  DEFAULT_CREATOR_STATUS,
} from "@/modules/creators/interfaces/creator.interface";

/**
 * PR003 — Prisma enum ↔ client-safe mirror sync.
 *
 * The dashboard imports the mirrors from `creator.interface.ts` (client
 * components cannot import `@prisma/client` at runtime). A drift between
 * the two breaks the filters silently — these tests make it loud.
 */

describe("CreatorSource (Prisma enum)", () => {
  it("has exactly the five PR003 values", () => {
    expect(Object.values(CreatorSource)).toEqual([
      "MOCK",
      "TIKTOK",
      "INSTAGRAM",
      "SHOPEE",
      "MANUAL",
    ]);
  });

  it("maps each value to itself (string enum)", () => {
    expect(CreatorSource.MOCK).toBe("MOCK");
    expect(CreatorSource.TIKTOK).toBe("TIKTOK");
    expect(CreatorSource.INSTAGRAM).toBe("INSTAGRAM");
    expect(CreatorSource.SHOPEE).toBe("SHOPEE");
    expect(CreatorSource.MANUAL).toBe("MANUAL");
  });
});

describe("CreatorStatus (Prisma enum)", () => {
  it("has exactly the six PR003 pipeline values", () => {
    expect(Object.values(CreatorStatus)).toEqual([
      "NEW",
      "QUALIFIED",
      "CONTACTED",
      "NEGOTIATING",
      "ACTIVE",
      "ARCHIVED",
    ]);
  });

  it("maps each value to itself (string enum)", () => {
    expect(CreatorStatus.NEW).toBe("NEW");
    expect(CreatorStatus.QUALIFIED).toBe("QUALIFIED");
    expect(CreatorStatus.CONTACTED).toBe("CONTACTED");
    expect(CreatorStatus.NEGOTIATING).toBe("NEGOTIATING");
    expect(CreatorStatus.ACTIVE).toBe("ACTIVE");
    expect(CreatorStatus.ARCHIVED).toBe("ARCHIVED");
  });

  it("no longer carries the PR000 values (PROSPECT/INVITED/PAUSED are gone)", () => {
    const values = Object.values(CreatorStatus) as string[];
    expect(values).not.toContain("PROSPECT");
    expect(values).not.toContain("INVITED");
    expect(values).not.toContain("PAUSED");
  });
});

describe("CREATOR_SOURCES (client-safe mirror)", () => {
  it("is in sync with the Prisma enum (drift breaks the dashboard filter)", () => {
    expect(CREATOR_SOURCES).toEqual(Object.values(CreatorSource));
  });

  it("defaults to MOCK (discovery default source)", () => {
    expect(DEFAULT_CREATOR_SOURCE).toBe("MOCK");
  });
});

describe("CREATOR_STATUSES (client-safe mirror)", () => {
  it("is in sync with the Prisma enum, in funnel order", () => {
    expect(CREATOR_STATUSES).toEqual(Object.values(CreatorStatus));
  });

  it("defaults to NEW (every profile starts at the funnel entry)", () => {
    expect(DEFAULT_CREATOR_STATUS).toBe("NEW");
  });

  it("labels every status in pt-BR", () => {
    expect(CREATOR_STATUS_LABELS).toEqual({
      NEW: "Novo",
      QUALIFIED: "Qualificado",
      CONTACTED: "Contatado",
      NEGOTIATING: "Negociando",
      ACTIVE: "Ativo",
      ARCHIVED: "Arquivado",
    });
  });
});
