import { describe, expect, it } from "vitest";
import { ConnectorPlatform } from "@prisma/client";
import type { ConnectorState, ConnectorStatus, ExternalContent } from "@prisma/client";
import {
  toConnectorStatusDTO,
  toCreateExternalContentDTO,
  toExternalContentDTO,
  toExternalContentPageDTO,
} from "@/modules/connectors/core/connector.dto";
import type { NormalizedContent } from "@/modules/connectors/core/connector.interface";
import {
  contentListQuerySchema,
  normalizeExternalId,
  normalizedContentSchema,
  syncConnectorSchema,
  toggleConnectorSchema,
  SYNC_LIMIT_DEFAULT,
  SYNC_LIMIT_MAX,
} from "@/modules/connectors/core/connector.validator";

/**
 * PR005 — DTOs and validators.
 *
 * DTOs are the RSC boundary: every Date must become an ISO string and no
 * secret material may cross. Validators are the write boundary: a
 * misbehaving adapter (or a malformed URL) must never reach the database.
 */

const NOW = new Date(Date.UTC(2026, 8, 22, 12, 0, 0));

function contentRow(overrides: Partial<ExternalContent> = {}): ExternalContent {
  return {
    id: "content_1",
    platform: ConnectorPlatform.MOCK,
    externalId: "mock-video-001",
    type: "VIDEO",
    status: "IMPORTED",
    title: "Camisa masculina",
    url: "https://mock.brobond.local/video/001",
    thumbnailUrl: null,
    authorHandle: "@ana.souza",
    caption: null,
    views: 1000,
    likes: 100,
    shares: 10,
    publishedAt: NOW,
    errorReason: null,
    raw: null,
    connectorStatusId: "status_1",
    organizationId: "org_a",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ExternalContent;
}

function statusRow(overrides: Partial<ConnectorStatus> = {}): ConnectorStatus {
  return {
    id: "status_1",
    platform: ConnectorPlatform.MOCK,
    state: "ACTIVE" as ConnectorState,
    enabled: true,
    lastSyncAt: NOW,
    lastError: null,
    importedCount: 10,
    duplicateCount: 3,
    failedCount: 1,
    syncCount: 2,
    organizationId: "org_a",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as ConnectorStatus;
}

describe("toExternalContentDTO", () => {
  it("serializes every Date as an ISO string (RSC boundary)", () => {
    const dto = toExternalContentDTO(contentRow());
    expect(dto.createdAt).toBe(NOW.toISOString());
    expect(dto.publishedAt).toBe(NOW.toISOString());
  });

  it("maps a missing publishedAt to null rather than undefined", () => {
    expect(toExternalContentDTO(contentRow({ publishedAt: null })).publishedAt).toBeNull();
  });

  it("never exposes the tenant id or the raw provider payload", () => {
    const dto = toExternalContentDTO(contentRow({ raw: { secret: "token" } as never }));
    expect(dto).not.toHaveProperty("organizationId");
    expect(dto).not.toHaveProperty("raw");
  });

  it("carries the error reason of a FAILED row", () => {
    const dto = toExternalContentDTO(
      contentRow({ status: "FAILED", errorReason: "Título obrigatório." }),
    );
    expect(dto.status).toBe("FAILED");
    expect(dto.errorReason).toBe("Título obrigatório.");
  });
});

describe("toExternalContentPageDTO", () => {
  it("computes totalPages and never returns zero pages", () => {
    expect(toExternalContentPageDTO([], 1, 10, 0).totalPages).toBe(1);
    expect(toExternalContentPageDTO([], 1, 10, 25).totalPages).toBe(3);
    expect(toExternalContentPageDTO([], 1, 10, 30).totalPages).toBe(3);
  });

  it("maps every row through the item DTO", () => {
    const page = toExternalContentPageDTO(
      [contentRow(), contentRow({ id: "content_2" })],
      2,
      10,
      12,
    );
    expect(page.items).toHaveLength(2);
    expect(page.page).toBe(2);
    expect(page.total).toBe(12);
  });
});

describe("toConnectorStatusDTO", () => {
  const descriptor = {
    platform: ConnectorPlatform.MOCK,
    name: "Mock Connector",
    implemented: true,
  };

  it("merges the adapter descriptor with the persisted row", () => {
    const dto = toConnectorStatusDTO(descriptor, statusRow());
    expect(dto).toMatchObject({
      platform: ConnectorPlatform.MOCK,
      name: "Mock Connector",
      implemented: true,
      state: "ACTIVE",
      enabled: true,
      importedCount: 10,
      duplicateCount: 3,
      failedCount: 1,
      active: true,
    });
    expect(dto.lastSyncAt).toBe(NOW.toISOString());
  });

  it("renders a never-synced platform as IDLE with zeroed counters", () => {
    const dto = toConnectorStatusDTO(descriptor, null);
    expect(dto).toMatchObject({
      state: "IDLE",
      enabled: false,
      importedCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      syncCount: 0,
      active: false,
    });
    expect(dto.lastSyncAt).toBeNull();
  });

  it("`active` requires enabled AND ACTIVE", () => {
    expect(toConnectorStatusDTO(descriptor, statusRow({ enabled: false })).active).toBe(false);
    expect(
      toConnectorStatusDTO(descriptor, statusRow({ state: "ERROR" as ConnectorState })).active,
    ).toBe(false);
    expect(
      toConnectorStatusDTO(descriptor, statusRow({ state: "IDLE" as ConnectorState })).active,
    ).toBe(false);
  });

  it("keeps a placeholder descriptor's `implemented: false`", () => {
    const dto = toConnectorStatusDTO(
      { platform: ConnectorPlatform.TIKTOK, name: "TikTok Connector", implemented: false },
      null,
    );
    expect(dto.implemented).toBe(false);
  });
});

describe("toCreateExternalContentDTO", () => {
  const content: NormalizedContent = {
    externalId: "mock-video-001",
    type: "VIDEO",
    title: "Camisa masculina",
    views: 1000,
    likes: 100,
    shares: 10,
  };

  it("defaults missing engagement numbers to 0 (never undefined in the DB)", () => {
    const dto = toCreateExternalContentDTO(
      { externalId: "x", type: "POST", title: "t" },
      ConnectorPlatform.MOCK,
      "IMPORTED",
    );
    expect(dto).toMatchObject({ views: 0, likes: 0, shares: 0 });
  });

  it("takes the status from the SYNC SERVICE, never from the connector", () => {
    for (const status of ["IMPORTED", "DUPLICATE", "FAILED"] as const) {
      expect(toCreateExternalContentDTO(content, ConnectorPlatform.MOCK, status).status).toBe(
        status,
      );
    }
  });

  it("stamps the platform passed by the caller", () => {
    expect(toCreateExternalContentDTO(content, ConnectorPlatform.SHOPEE, "IMPORTED").platform).toBe(
      ConnectorPlatform.SHOPEE,
    );
  });

  it("threads the connectorStatusId and the errorReason", () => {
    const dto = toCreateExternalContentDTO(content, ConnectorPlatform.MOCK, "FAILED", {
      connectorStatusId: "status_1",
      errorReason: "boom",
    });
    expect(dto.connectorStatusId).toBe("status_1");
    expect(dto.errorReason).toBe("boom");
  });
});

describe("normalizedContentSchema", () => {
  const valid = { externalId: "mock-1", type: "VIDEO", title: "Camisa" };

  it("accepts a minimal item and defaults the counters to 0", () => {
    const parsed = normalizedContentSchema.parse(valid);
    expect(parsed).toMatchObject({ views: 0, likes: 0, shares: 0 });
  });

  it("canonicalizes the externalId (dedupe identity)", () => {
    expect(normalizeExternalId("  mock-1  ")).toBe("mock-1");
    expect(normalizeExternalId("mock   1")).toBe("mock 1");
    expect(normalizedContentSchema.parse({ ...valid, externalId: " mock-1 " }).externalId).toBe(
      "mock-1",
    );
  });

  it("rejects an empty externalId or title", () => {
    expect(() => normalizedContentSchema.parse({ ...valid, externalId: "   " })).toThrow();
    expect(() => normalizedContentSchema.parse({ ...valid, title: "" })).toThrow();
  });

  it("rejects negative or non-integer engagement numbers", () => {
    expect(() => normalizedContentSchema.parse({ ...valid, views: -1 })).toThrow();
    expect(() => normalizedContentSchema.parse({ ...valid, likes: 1.5 })).toThrow();
  });

  it("rejects an unknown content type instead of guessing", () => {
    expect(() => normalizedContentSchema.parse({ ...valid, type: "REEL" })).toThrow();
  });

  it("rejects a malformed url", () => {
    expect(() => normalizedContentSchema.parse({ ...valid, url: "not-a-url" })).toThrow();
  });
});

describe("syncConnectorSchema / toggleConnectorSchema", () => {
  it("defaults the sync limit and caps it", () => {
    expect(syncConnectorSchema.parse({ platform: "MOCK" }).limit).toBe(SYNC_LIMIT_DEFAULT);
    expect(syncConnectorSchema.parse({ platform: "MOCK", limit: "25" }).limit).toBe(25);
    expect(() =>
      syncConnectorSchema.parse({ platform: "MOCK", limit: SYNC_LIMIT_MAX + 1 }),
    ).toThrow();
    expect(() => syncConnectorSchema.parse({ platform: "MOCK", limit: 0 })).toThrow();
  });

  it("rejects an unknown platform", () => {
    expect(() => syncConnectorSchema.parse({ platform: "YOUTUBE" })).toThrow();
    expect(() => toggleConnectorSchema.parse({ platform: "YOUTUBE", enabled: true })).toThrow();
  });

  it("never accepts an organizationId from the client", () => {
    const parsed = syncConnectorSchema.parse({ platform: "MOCK", organizationId: "org_evil" });
    expect(parsed).not.toHaveProperty("organizationId");
  });

  it("toggle requires a real boolean", () => {
    expect(toggleConnectorSchema.parse({ platform: "MOCK", enabled: false }).enabled).toBe(false);
    expect(() => toggleConnectorSchema.parse({ platform: "MOCK", enabled: "yes" })).toThrow();
  });
});

describe("contentListQuerySchema (dashboard URL state)", () => {
  it("applies safe defaults for an empty URL", () => {
    const query = contentListQuerySchema.parse({});
    expect(query).toMatchObject({ page: 1, pageSize: 10, sort: "createdAt", order: "desc" });
    expect(query.platform).toBeUndefined();
    expect(query.status).toBeUndefined();
    expect(query.type).toBeUndefined();
  });

  it("parses valid filters from the URL", () => {
    const query = contentListQuerySchema.parse({
      search: "camisa",
      platform: "TIKTOK",
      status: "DUPLICATE",
      type: "IMAGE",
      sort: "views",
      order: "asc",
      page: "3",
      pageSize: "25",
    });
    expect(query).toMatchObject({
      search: "camisa",
      platform: "TIKTOK",
      status: "DUPLICATE",
      type: "IMAGE",
      sort: "views",
      order: "asc",
      page: 3,
      pageSize: 25,
    });
  });

  it("falls back instead of throwing on garbage (a bad URL is never a 500)", () => {
    const query = contentListQuerySchema.parse({
      platform: "nope",
      status: "nope",
      type: "nope",
      sort: "DROP TABLE",
      order: "sideways",
      page: "-4",
      pageSize: "9999",
    });
    expect(query.platform).toBeUndefined();
    expect(query.status).toBeUndefined();
    expect(query.type).toBeUndefined();
    expect(query.sort).toBe("createdAt");
    expect(query.order).toBe("desc");
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(10);
  });

  it("treats an empty search as absent", () => {
    expect(contentListQuerySchema.parse({ search: "   " }).search).toBeUndefined();
  });
});
