import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TrendSource } from "@prisma/client";
import { getCollector, getTrendCollector } from "@/modules/trends/hunter/collector.factory";
import {
  MockCollector,
  MockTrendCollector,
  ShopeeCollector,
  TikTokCollector,
  InstagramCollector,
} from "@/modules/trends/hunter/collectors";
import { getCollector as getCollectorFromFacade } from "@/modules/trends/hunter/collector";
import type { TrendCollector } from "@/modules/trends/interfaces/trend.interface";

/**
 * PR002.1 — Collector Factory.
 *
 * `getCollector(source)` is the SINGLE point where a `TrendSource` resolves
 * to its `TrendCollector`. These tests pin:
 *
 *   1. every source maps to the right collector (and `source` matches);
 *   2. real sources are placeholders that throw "Not implemented";
 *   3. MANUAL has no collector (manual trends come from the dashboard form);
 *   4. the factory is the only place allowed to map source → implementation.
 */

const COLLECTORS_DIR = path.resolve(__dirname, "..", "modules", "trends", "hunter");

describe("getCollector() — source resolution", () => {
  it("MOCK resolves to the MockCollector", () => {
    const collector = getCollector(TrendSource.MOCK);
    expect(collector).toBeInstanceOf(MockCollector);
    expect(collector.source).toBe(TrendSource.MOCK);
  });

  it("TIKTOK resolves to the TikTokCollector", () => {
    const collector = getCollector(TrendSource.TIKTOK);
    expect(collector).toBeInstanceOf(TikTokCollector);
    expect(collector.source).toBe(TrendSource.TIKTOK);
  });

  it("SHOPEE resolves to the ShopeeCollector", () => {
    const collector = getCollector(TrendSource.SHOPEE);
    expect(collector).toBeInstanceOf(ShopeeCollector);
    expect(collector.source).toBe(TrendSource.SHOPEE);
  });

  it("INSTAGRAM resolves to the InstagramCollector", () => {
    const collector = getCollector(TrendSource.INSTAGRAM);
    expect(collector).toBeInstanceOf(InstagramCollector);
    expect(collector.source).toBe(TrendSource.INSTAGRAM);
  });

  it("resolves every source that has a collector (exactly 4)", () => {
    const resolvable = Object.values(TrendSource).filter((source) => source !== TrendSource.MANUAL);
    expect(resolvable).toHaveLength(4);
    for (const source of resolvable) {
      expect(getCollector(source).source).toBe(source);
    }
  });

  it("caches one instance per source (stable references)", () => {
    expect(getCollector(TrendSource.MOCK)).toBe(getCollector(TrendSource.MOCK));
    expect(getCollector(TrendSource.TIKTOK)).toBe(getCollector(TrendSource.TIKTOK));
    // different sources never share an instance
    expect(getCollector(TrendSource.MOCK)).not.toBe(getCollector(TrendSource.TIKTOK));
  });

  it("is also exported from the PR002 façade (hunter/collector)", () => {
    // Retrocompatibility: the old module path keeps re-exporting the factory.
    expect(getCollectorFromFacade(TrendSource.MOCK)).toBe(getCollector(TrendSource.MOCK));
  });
});

describe("getCollector() — MANUAL and unknown sources", () => {
  it("MANUAL has no collector — manual trends are created, not collected", () => {
    expect(() => getCollector(TrendSource.MANUAL)).toThrow(/MANUAL/);
  });

  it("throws a helpful message for MANUAL (points to the form)", () => {
    expect(() => getCollector(TrendSource.MANUAL)).toThrow(/dashboard form/i);
  });

  it("throws for an unregistered source at runtime (defensive)", () => {
    expect(() => getCollector("NOT_A_SOURCE" as TrendSource)).toThrow(/No TrendCollector/);
  });
});

describe("real collectors are placeholders (Not implemented)", () => {
  it.each([
    ["TikTokCollector", new TikTokCollector()],
    ["ShopeeCollector", new ShopeeCollector()],
    ["InstagramCollector", new InstagramCollector()],
  ])("%s.collect() throws 'Not implemented'", async (_name, collector) => {
    await expect(collector.collect()).rejects.toThrow("Not implemented");
  });

  it.each([
    ["TikTokCollector", new TikTokCollector()],
    ["ShopeeCollector", new ShopeeCollector()],
    ["InstagramCollector", new InstagramCollector()],
  ])("%s keeps the PR002 alias throwing the same error", async (_name, collector) => {
    await expect(collector.collectDailyTrends!()).rejects.toThrow("Not implemented");
  });
});

describe("every collector implements the TrendCollector contract", () => {
  const collectors: TrendCollector[] = [
    new MockCollector(),
    new TikTokCollector(),
    new ShopeeCollector(),
    new InstagramCollector(),
  ];

  it("exposes source + collect() on every implementation", () => {
    for (const collector of collectors) {
      expect(typeof collector.collect).toBe("function");
      expect(Object.values(TrendSource)).toContain(collector.source);
    }
  });

  it("the mock collector actually returns data (30 candidates)", async () => {
    const candidates = await new MockCollector().collect();
    expect(candidates).toHaveLength(30);
  });

  it("MockTrendCollector is the retrocompatible PR002 name of MockCollector", () => {
    expect(MockTrendCollector).toBe(MockCollector);
    expect(new MockTrendCollector()).toBeInstanceOf(MockCollector);
  });
});

describe("getTrendCollector() — PR002 retrocompatible resolver", () => {
  it("returns the MOCK collector singleton (same as getCollector(MOCK))", () => {
    const collector = getTrendCollector();
    expect(collector).toBeInstanceOf(MockCollector);
    expect(collector).toBe(getCollector(TrendSource.MOCK));
  });

  it("keeps singleton semantics (stable instance)", () => {
    expect(getTrendCollector()).toBe(getTrendCollector());
  });
});

describe("architecture — source mapping lives ONLY in the factory", () => {
  it("no switch statement anywhere in modules/trends (map-based factory only)", () => {
    // PR002.1 rule: a TrendSource must never be resolved through a `switch`
    // outside collector.factory.ts. The factory itself uses a record map, so
    // the whole module tree must be switch-free.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(COLLECTORS_DIR);

    expect(files.length).toBeGreaterThan(5); // sanity: we did walk the module
    const offenders = files.filter((file) => /\bswitch\s*\(/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
