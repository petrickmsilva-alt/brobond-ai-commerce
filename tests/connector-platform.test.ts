import { describe, expect, it } from "vitest";
import {
  ConnectorPlatform,
  ConnectorState,
  ExternalContentStatus,
  ExternalContentType,
} from "@prisma/client";
import {
  CONNECTOR_PLATFORM_LABELS,
  CONNECTOR_PLATFORMS,
  CONNECTOR_STATE_LABELS,
  CONNECTOR_STATES,
  DEFAULT_CONNECTOR_PLATFORM,
  DEFAULT_CONNECTOR_STATE,
  EXTERNAL_CONTENT_STATUS_LABELS,
  EXTERNAL_CONTENT_STATUSES,
  EXTERNAL_CONTENT_TYPE_LABELS,
  EXTERNAL_CONTENT_TYPES,
  PLACEHOLDER_CONNECTOR_PLATFORMS,
  isConnectorActive,
  isConnectorPlatformName,
  isExternalContentStatusName,
} from "@/modules/connectors/core/connector.interface";
import {
  connectorPlatformSchema,
  connectorStateSchema,
  externalContentStatusSchema,
  externalContentTypeSchema,
} from "@/modules/connectors/core/connector.validator";

/**
 * PR005 — the connector enums and their TypeScript mirrors.
 *
 * Each enum exists in THREE places that must never drift apart:
 *   1. Prisma (`prisma/schema.prisma` — the database);
 *   2. the client-safe consts (modules/connectors/core/connector.interface);
 *   3. the Zod schemas (modules/connectors/core/connector.validator).
 *
 * These tests pin all three, so a change in one place that would silently
 * break the dashboard filters (or let an invalid value reach the database)
 * fails CI.
 */

describe("ConnectorPlatform (Prisma enum)", () => {
  it("has exactly the four PR005 platforms", () => {
    expect(Object.values(ConnectorPlatform)).toEqual(["MOCK", "TIKTOK", "INSTAGRAM", "SHOPEE"]);
  });

  it("maps each value to itself (string enum)", () => {
    expect(ConnectorPlatform.MOCK).toBe("MOCK");
    expect(ConnectorPlatform.TIKTOK).toBe("TIKTOK");
    expect(ConnectorPlatform.INSTAGRAM).toBe("INSTAGRAM");
    expect(ConnectorPlatform.SHOPEE).toBe("SHOPEE");
  });
});

describe("CONNECTOR_PLATFORMS (client-safe mirror)", () => {
  it("is in sync with the Prisma enum (drift breaks the dashboard filter)", () => {
    expect([...CONNECTOR_PLATFORMS]).toEqual(Object.values(ConnectorPlatform));
  });

  it("has a pt-BR display label for every platform", () => {
    for (const platform of CONNECTOR_PLATFORMS) {
      expect(typeof CONNECTOR_PLATFORM_LABELS[platform]).toBe("string");
      expect(CONNECTOR_PLATFORM_LABELS[platform].length).toBeGreaterThan(0);
    }
  });

  it("defaults to MOCK — the only implemented platform in PR005", () => {
    expect(DEFAULT_CONNECTOR_PLATFORM).toBe("MOCK");
    expect(DEFAULT_CONNECTOR_PLATFORM).toBe(ConnectorPlatform.MOCK);
  });

  it("keeps only Instagram and Shopee as placeholders after PR009", () => {
    expect([...PLACEHOLDER_CONNECTOR_PLATFORMS]).toEqual(["INSTAGRAM", "SHOPEE"]);
    expect(PLACEHOLDER_CONNECTOR_PLATFORMS).not.toContain("TIKTOK");
  });

  it("default plus real TikTok plus placeholders cover every registered platform", () => {
    expect(
      new Set([DEFAULT_CONNECTOR_PLATFORM, "TIKTOK", ...PLACEHOLDER_CONNECTOR_PLATFORMS]),
    ).toEqual(new Set(CONNECTOR_PLATFORMS));
  });
});

describe("ConnectorState", () => {
  it("is in sync with the Prisma enum", () => {
    expect([...CONNECTOR_STATES]).toEqual(Object.values(ConnectorState));
    expect(CONNECTOR_STATES).toEqual(["IDLE", "ACTIVE", "ERROR", "DISABLED"]);
  });

  it("starts at IDLE (registered, never synced)", () => {
    expect(DEFAULT_CONNECTOR_STATE).toBe("IDLE");
  });

  it("has a pt-BR label for every state", () => {
    for (const state of CONNECTOR_STATES) {
      expect(CONNECTOR_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });
});

describe("isConnectorActive — the 'Conectores ativos' KPI predicate", () => {
  it("is active only when enabled AND the last run succeeded", () => {
    expect(isConnectorActive({ enabled: true, state: "ACTIVE" })).toBe(true);
  });

  it("a disabled connector never counts, whatever its state", () => {
    for (const state of CONNECTOR_STATES) {
      expect(isConnectorActive({ enabled: false, state })).toBe(false);
    }
  });

  it("an enabled connector that has not synced (IDLE) does not count", () => {
    expect(isConnectorActive({ enabled: true, state: "IDLE" })).toBe(false);
  });

  it("an enabled connector whose last run failed does not count", () => {
    expect(isConnectorActive({ enabled: true, state: "ERROR" })).toBe(false);
  });
});

describe("ExternalContentType / ExternalContentStatus", () => {
  it("types are in sync with the Prisma enum", () => {
    expect([...EXTERNAL_CONTENT_TYPES]).toEqual(Object.values(ExternalContentType));
  });

  it("statuses are in sync with the Prisma enum", () => {
    expect([...EXTERNAL_CONTENT_STATUSES]).toEqual(Object.values(ExternalContentStatus));
    expect(EXTERNAL_CONTENT_STATUSES).toEqual(["IMPORTED", "DUPLICATE", "FAILED"]);
  });

  it("the three statuses map 1:1 to the three content KPIs", () => {
    expect(EXTERNAL_CONTENT_STATUS_LABELS.IMPORTED).toBe("Importado");
    expect(EXTERNAL_CONTENT_STATUS_LABELS.DUPLICATE).toBe("Duplicado");
    expect(EXTERNAL_CONTENT_STATUS_LABELS.FAILED).toBe("Falha");
  });

  it("has a pt-BR label for every content type", () => {
    for (const type of EXTERNAL_CONTENT_TYPES) {
      expect(EXTERNAL_CONTENT_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });
});

describe("Zod schemas", () => {
  it("accept every valid platform / state / type / status", () => {
    for (const platform of CONNECTOR_PLATFORMS) {
      expect(connectorPlatformSchema.parse(platform)).toBe(platform);
    }
    for (const state of CONNECTOR_STATES) {
      expect(connectorStateSchema.parse(state)).toBe(state);
    }
    for (const type of EXTERNAL_CONTENT_TYPES) {
      expect(externalContentTypeSchema.parse(type)).toBe(type);
    }
    for (const status of EXTERNAL_CONTENT_STATUSES) {
      expect(externalContentStatusSchema.parse(status)).toBe(status);
    }
  });

  it("reject invalid values instead of guessing", () => {
    for (const value of ["", "mock", "tiktok", "YOUTUBE", "MOCK ", "0"]) {
      expect(() => connectorPlatformSchema.parse(value)).toThrow();
    }
    expect(() => connectorStateSchema.parse("RUNNING")).toThrow();
    expect(() => externalContentTypeSchema.parse("REEL")).toThrow();
    expect(() => externalContentStatusSchema.parse("SKIPPED")).toThrow();
  });

  it("reject non-string values", () => {
    expect(() => connectorPlatformSchema.parse(1)).toThrow();
    expect(() => connectorPlatformSchema.parse(null)).toThrow();
    expect(() => connectorPlatformSchema.parse(undefined)).toThrow();
  });
});

describe("type guards", () => {
  it("isConnectorPlatformName recognizes exactly the four platforms", () => {
    for (const platform of CONNECTOR_PLATFORMS) {
      expect(isConnectorPlatformName(platform)).toBe(true);
    }
    for (const value of ["YOUTUBE", "mock", "", 1, null, undefined, {}]) {
      expect(isConnectorPlatformName(value)).toBe(false);
    }
  });

  it("isExternalContentStatusName recognizes exactly the three statuses", () => {
    for (const status of EXTERNAL_CONTENT_STATUSES) {
      expect(isExternalContentStatusName(status)).toBe(true);
    }
    for (const value of ["SKIPPED", "imported", "", 0, null]) {
      expect(isExternalContentStatusName(value)).toBe(false);
    }
  });
});
