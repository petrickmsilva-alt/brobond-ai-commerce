import { describe, expect, it } from "vitest";
import {
  analyticsDaysSchema,
  refreshAnalyticsSchema,
} from "@/modules/analytics/validators/analytics.validator";

describe("analyticsDaysSchema — PR008", () => {
  it("defaults to 30 days", () => {
    expect(analyticsDaysSchema.parse(undefined)).toBe(30);
  });

  it("coerces string query params", () => {
    expect(analyticsDaysSchema.parse("7")).toBe(7);
    expect(analyticsDaysSchema.parse("90")).toBe(90);
  });

  it("accepts the exact bounds", () => {
    expect(analyticsDaysSchema.parse(1)).toBe(1);
    expect(analyticsDaysSchema.parse(365)).toBe(365);
  });

  it("rejects out-of-bounds periods", () => {
    expect(analyticsDaysSchema.safeParse(0).success).toBe(false);
    expect(analyticsDaysSchema.safeParse(-30).success).toBe(false);
    expect(analyticsDaysSchema.safeParse(366).success).toBe(false);
  });

  it("rejects non-integers and non-numeric values", () => {
    expect(analyticsDaysSchema.safeParse(7.5).success).toBe(false);
    expect(analyticsDaysSchema.safeParse("abc").success).toBe(false);
  });
});

describe("refreshAnalyticsSchema — PR008", () => {
  it("parses the refresh input with defaults", () => {
    expect(refreshAnalyticsSchema.parse({})).toEqual({ days: 30 });
    expect(refreshAnalyticsSchema.parse({ days: 14 })).toEqual({ days: 14 });
  });

  it("rejects hostile payloads", () => {
    expect(refreshAnalyticsSchema.safeParse({ days: 9999 }).success).toBe(false);
    expect(refreshAnalyticsSchema.safeParse("junk").success).toBe(false);
  });
});
