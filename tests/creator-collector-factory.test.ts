import { describe, expect, it } from "vitest";
import { CreatorSource } from "@prisma/client";
import {
  getCreatorCollector,
  getDefaultCreatorCollector,
} from "@/modules/creators/discovery/collector.factory";
import { MockCreatorCollector } from "@/modules/creators/discovery/collectors/MockCreatorCollector";
import { TikTokCreatorCollector } from "@/modules/creators/discovery/collectors/TikTokCreatorCollector";
import { InstagramCreatorCollector } from "@/modules/creators/discovery/collectors/InstagramCreatorCollector";
import { ShopeeCreatorCollector } from "@/modules/creators/discovery/collectors/ShopeeCreatorCollector";
import type { CreatorCollector } from "@/modules/creators/interfaces/creator.interface";

/**
 * PR003 — the collector factory.
 *
 * `getCreatorCollector(source)` is the ONLY supported way to obtain a
 * collector. Only MOCK is implemented; TIKTOK/INSTAGRAM/SHOPEE resolve to
 * placeholders that throw on collect(); MANUAL has no collector by design.
 */

describe("getCreatorCollector", () => {
  it("resolves MOCK to the MockCreatorCollector", () => {
    expect(getCreatorCollector(CreatorSource.MOCK)).toBeInstanceOf(MockCreatorCollector);
  });

  it("resolves TIKTOK to the TikTok placeholder", () => {
    expect(getCreatorCollector(CreatorSource.TIKTOK)).toBeInstanceOf(TikTokCreatorCollector);
  });

  it("resolves INSTAGRAM to the Instagram placeholder", () => {
    expect(getCreatorCollector(CreatorSource.INSTAGRAM)).toBeInstanceOf(InstagramCreatorCollector);
  });

  it("resolves SHOPEE to the Shopee placeholder", () => {
    expect(getCreatorCollector(CreatorSource.SHOPEE)).toBeInstanceOf(ShopeeCreatorCollector);
  });

  it("every resolved collector declares its own source", () => {
    for (const source of [
      CreatorSource.MOCK,
      CreatorSource.TIKTOK,
      CreatorSource.INSTAGRAM,
      CreatorSource.SHOPEE,
    ]) {
      expect(getCreatorCollector(source).source).toBe(source);
    }
  });

  it("is a lazy singleton per source (stable instances)", () => {
    expect(getCreatorCollector(CreatorSource.MOCK)).toBe(getCreatorCollector(CreatorSource.MOCK));
    expect(getCreatorCollector(CreatorSource.TIKTOK)).toBe(
      getCreatorCollector(CreatorSource.TIKTOK),
    );
    expect(getCreatorCollector(CreatorSource.MOCK)).not.toBe(
      getCreatorCollector(CreatorSource.TIKTOK),
    );
  });

  it("throws for MANUAL (no collector by design)", () => {
    expect(() => getCreatorCollector(CreatorSource.MANUAL)).toThrowError(/MANUAL/);
  });

  it("throws for an unregistered source", () => {
    expect(() => getCreatorCollector("LINKEDIN" as CreatorSource)).toThrowError(
      /No CreatorCollector is registered/,
    );
  });

  it("satisfies the CreatorCollector contract for every registered source", () => {
    const collectors: CreatorCollector[] = [
      getCreatorCollector(CreatorSource.MOCK),
      getCreatorCollector(CreatorSource.TIKTOK),
      getCreatorCollector(CreatorSource.INSTAGRAM),
      getCreatorCollector(CreatorSource.SHOPEE),
    ];
    for (const collector of collectors) {
      expect(typeof collector.collect).toBe("function");
      expect(Object.values(CreatorSource)).toContain(collector.source);
    }
  });
});

describe("getDefaultCreatorCollector", () => {
  it("returns the mock collector (MOCK remains the default source)", () => {
    expect(getDefaultCreatorCollector()).toBeInstanceOf(MockCreatorCollector);
  });

  it("is equivalent to getCreatorCollector(MOCK)", () => {
    expect(getDefaultCreatorCollector()).toBe(getCreatorCollector(CreatorSource.MOCK));
  });

  it("actually collects the 100-candidate dataset", async () => {
    const candidates = await getDefaultCreatorCollector().collect();
    expect(candidates).toHaveLength(100);
  });
});
