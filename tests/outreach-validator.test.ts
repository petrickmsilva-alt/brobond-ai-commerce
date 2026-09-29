import { describe, expect, it } from "vitest";
import { TemplateType } from "@prisma/client";
import { createMessageSchema } from "@/modules/outreach/dto/create-message.dto";
import {
  messageTemplateSchema,
  outreachListSchema,
  updateMessageSchema,
} from "@/modules/outreach/validators/outreach.validator";

describe("Outreach validators", () => {
  const ids = { creatorId: "c", productId: "p", campaignId: "x", templateId: "t" };
  it("accepts a complete draft DTO", () => {
    expect(createMessageSchema.parse({ ...ids, generatedText: "Olá" })).toMatchObject(ids);
  });
  it.each(["creatorId", "productId", "campaignId", "templateId"] as const)("requires %s", (key) => {
    expect(createMessageSchema.safeParse({ ...ids, [key]: "", generatedText: "Olá" }).success).toBe(
      false,
    );
  });
  it("limits message text to 5000 characters", () => {
    expect(createMessageSchema.safeParse({ ...ids, generatedText: "x".repeat(5001) }).success).toBe(
      false,
    );
  });
  it("validates updates", () => {
    expect(updateMessageSchema.safeParse({ id: "m", generatedText: "editada" }).success).toBe(true);
  });
  it.each(Object.values(TemplateType))("accepts the %s template category", (type) => {
    expect(
      messageTemplateSchema.safeParse({
        name: "Template bom",
        type,
        content: "Olá {{creatorName}}, tudo bem?",
      }).success,
    ).toBe(true);
  });
  it("rejects arbitrary template variables", () => {
    const result = messageTemplateSchema.safeParse({
      name: "Template ruim",
      type: TemplateType.FIRST_CONTACT,
      content: "Olá {{password}}, tudo bem?",
    });
    expect(result.success).toBe(false);
  });
  it("allows all five canonical variables", () => {
    const content = "{{creatorName}} {{niche}} {{productName}} {{campaignName}} {{trendKeyword}}";
    expect(
      messageTemplateSchema.safeParse({
        name: "Template completo",
        type: TemplateType.FIRST_CONTACT,
        content,
      }).success,
    ).toBe(true);
  });
  it("provides safe pagination defaults", () => {
    expect(outreachListSchema.parse({})).toMatchObject({ page: 1, pageSize: 50 });
  });
  it("caps page size", () =>
    expect(outreachListSchema.safeParse({ pageSize: 101 }).success).toBe(false));
});
