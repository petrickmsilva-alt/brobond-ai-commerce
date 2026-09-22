import { describe, expect, it } from "vitest";
import {
  aiMessageListSchema,
  generateAiMessageSchema,
} from "@/modules/ai/validators/generate-message.validator";

describe("generateAiMessageSchema", () => {
  const valid = {
    creatorId: "creator_1",
    productId: "product_1",
    campaignId: "campaign_1",
    tone: "FRIENDLY",
  };

  it("accepts a fully valid payload", () => {
    expect(generateAiMessageSchema.parse(valid)).toEqual(valid);
  });

  it.each(["creatorId", "productId", "campaignId"])("rejects a blank %s", (field) => {
    expect(() => generateAiMessageSchema.parse({ ...valid, [field]: "" })).toThrow();
  });

  it("rejects a missing tone", () => {
    const { tone: _tone, ...rest } = valid;
    expect(() => generateAiMessageSchema.parse(rest)).toThrow();
  });

  it("rejects an unsupported tone", () => {
    expect(() => generateAiMessageSchema.parse({ ...valid, tone: "SARCASTIC" })).toThrow();
  });

  it.each(["FRIENDLY", "PREMIUM", "LUXURY", "STREET", "FITNESS"])("accepts the %s tone", (tone) => {
    expect(generateAiMessageSchema.parse({ ...valid, tone }).tone).toBe(tone);
  });
});

describe("aiMessageListSchema", () => {
  it("defaults page and pageSize", () => {
    expect(aiMessageListSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it("coerces string numbers", () => {
    expect(aiMessageListSchema.parse({ page: "2", pageSize: "10" })).toEqual({
      page: 2,
      pageSize: 10,
    });
  });

  it("rejects a pageSize above 100", () => {
    expect(() => aiMessageListSchema.parse({ pageSize: 101 })).toThrow();
  });

  it("rejects a non-positive page", () => {
    expect(() => aiMessageListSchema.parse({ page: 0 })).toThrow();
  });

  it("accepts an optional tone filter", () => {
    expect(aiMessageListSchema.parse({ tone: "STREET" }).tone).toBe("STREET");
  });
});
