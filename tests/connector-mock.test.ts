import { describe, expect, it } from "vitest";
import { ConnectorPlatform } from "@prisma/client";
import {
  MOCK_CONTENT_COUNT,
  MOCK_DUPLICATE_CONTENT_COUNT,
  MOCK_EXTERNAL_CONTENT,
  MOCK_TYPE_DISTRIBUTION,
  MOCK_UNIQUE_CONTENT_COUNT,
  MockConnector,
} from "@/modules/connectors/mock/mock.connector";
import { normalizedContentSchema } from "@/modules/connectors/core/connector.validator";

/**
 * PR005 — the MOCK connector, the only implemented adapter.
 *
 * The dataset must be DETERMINISTIC (two runs produce identical items) and
 * must contain deliberate duplicates, so the dedupe path — and therefore
 * the "Duplicados" KPI — is exercised without test-only wiring.
 *
 * It must also perform ZERO network access: PR005 integrates no real API.
 */

describe("MOCK_EXTERNAL_CONTENT dataset", () => {
  it("contains the documented number of items", () => {
    expect(MOCK_EXTERNAL_CONTENT).toHaveLength(MOCK_CONTENT_COUNT);
    expect(MOCK_CONTENT_COUNT).toBe(MOCK_UNIQUE_CONTENT_COUNT + MOCK_DUPLICATE_CONTENT_COUNT);
  });

  it("is frozen (callers cannot mutate the module state)", () => {
    expect(Object.isFrozen(MOCK_EXTERNAL_CONTENT)).toBe(true);
  });

  it("respects the declared content-type distribution for the unique items", () => {
    const unique = MOCK_EXTERNAL_CONTENT.slice(0, MOCK_UNIQUE_CONTENT_COUNT);
    for (const [type, count] of MOCK_TYPE_DISTRIBUTION) {
      expect(unique.filter((item) => item.type === type)).toHaveLength(count);
    }
    expect(MOCK_TYPE_DISTRIBUTION.reduce((sum, [, count]) => sum + count, 0)).toBe(
      MOCK_UNIQUE_CONTENT_COUNT,
    );
  });

  it("has exactly MOCK_UNIQUE_CONTENT_COUNT distinct externalIds", () => {
    const ids = new Set(MOCK_EXTERNAL_CONTENT.map((item) => item.externalId));
    expect(ids.size).toBe(MOCK_UNIQUE_CONTENT_COUNT);
  });

  it("appends deliberate duplicates (the 'Duplicados' KPI has data)", () => {
    const tail = MOCK_EXTERNAL_CONTENT.slice(MOCK_UNIQUE_CONTENT_COUNT);
    expect(tail).toHaveLength(MOCK_DUPLICATE_CONTENT_COUNT);
    for (const [index, duplicate] of tail.entries()) {
      expect(duplicate.externalId).toBe(MOCK_EXTERNAL_CONTENT[index]?.externalId);
    }
  });

  it("every item satisfies the normalized schema (no adapter can poison the DB)", () => {
    for (const item of MOCK_EXTERNAL_CONTENT) {
      expect(normalizedContentSchema.safeParse(item).success).toBe(true);
    }
  });

  it("carries realistic engagement numbers (likes ≤ views, shares ≤ likes)", () => {
    for (const item of MOCK_EXTERNAL_CONTENT.slice(0, MOCK_UNIQUE_CONTENT_COUNT)) {
      expect(item.views ?? 0).toBeGreaterThan(0);
      expect(item.likes ?? 0).toBeLessThanOrEqual(item.views ?? 0);
      expect(item.shares ?? 0).toBeLessThanOrEqual(item.likes ?? 0);
    }
  });

  it("uses a fixed epoch for publishedAt (no Date.now() — deterministic)", () => {
    for (const item of MOCK_EXTERNAL_CONTENT) {
      expect(item.publishedAt).toBeInstanceOf(Date);
      expect(item.publishedAt!.getTime()).toBeLessThan(Date.UTC(2026, 8, 2));
    }
  });
});

describe("MockConnector", () => {
  const connector = new MockConnector();

  it("declares MOCK as its platform and reports itself implemented", () => {
    expect(connector.platform).toBe(ConnectorPlatform.MOCK);
    expect(connector.implemented).toBe(true);
    expect(connector.name).toBe("Mock Connector");
  });

  it("returns the whole dataset when unbounded", async () => {
    await expect(connector.fetchContent()).resolves.toHaveLength(MOCK_CONTENT_COUNT);
  });

  it("is deterministic — two runs return identical items", async () => {
    const [first, second] = await Promise.all([connector.fetchContent(), connector.fetchContent()]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("returns defensive copies (mutating the result never leaks back)", async () => {
    const items = await connector.fetchContent();
    items[0]!.title = "mutated";
    items[0]!.views = -1;
    const fresh = await connector.fetchContent();
    expect(fresh[0]!.title).not.toBe("mutated");
    expect(fresh[0]!.views).toBeGreaterThan(0);
  });

  it("honours the `limit` option", async () => {
    await expect(connector.fetchContent({ limit: 5 })).resolves.toHaveLength(5);
    await expect(connector.fetchContent({ limit: 0 })).resolves.toHaveLength(0);
    await expect(connector.fetchContent({ limit: 10_000 })).resolves.toHaveLength(
      MOCK_CONTENT_COUNT,
    );
  });

  it("honours the `type` option", async () => {
    const videos = await connector.fetchContent({ type: "VIDEO" });
    expect(videos.length).toBeGreaterThan(0);
    expect(videos.every((item) => item.type === "VIDEO")).toBe(true);

    const lives = await connector.fetchContent({ type: "LIVE" });
    expect(lives.every((item) => item.type === "LIVE")).toBe(true);
  });

  it("honours the `since` option", async () => {
    const since = new Date(Date.UTC(2026, 7, 25));
    const recent = await connector.fetchContent({ since });
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(MOCK_CONTENT_COUNT);
    for (const item of recent) {
      expect(item.publishedAt!.getTime()).toBeGreaterThanOrEqual(since.getTime());
    }
  });

  it("combines options (type + limit)", async () => {
    const items = await connector.fetchContent({ type: "IMAGE", limit: 3 });
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.type === "IMAGE")).toBe(true);
  });

  it("testConnection() reports healthy without touching the network", async () => {
    const health = await connector.testConnection();
    expect(health).toMatchObject({
      platform: ConnectorPlatform.MOCK,
      ok: true,
      implemented: true,
    });
    expect(health.message).toMatch(/sem acesso de rede/i);
  });
});
