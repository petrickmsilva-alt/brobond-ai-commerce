import { describe, expect, it } from "vitest";
import {
  commerceExecutionDeliverySchema,
  deliveryChannelSchema,
  deliveryFiltersSchema,
  deliveryMessageIdSchema,
  deliveryOAuthCallbackSchema,
  deliveryStatusSchema,
  disconnectDeliveryAccountSchema,
  outboundMessageSchema,
  sendDeliverySchema,
} from "@/modules/delivery/validators";

describe("delivery enum schemas", () => {
  it("channel schema accepts INSTAGRAM and WHATSAPP", () => {
    expect(deliveryChannelSchema.parse("INSTAGRAM")).toBe("INSTAGRAM");
    expect(deliveryChannelSchema.parse("WHATSAPP")).toBe("WHATSAPP");
  });

  it("channel schema rejects anything else", () => {
    for (const bad of ["TIKTOK", "instagram", "", "EMAIL", null, undefined, 1]) {
      expect(deliveryChannelSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("status schema accepts every lifecycle status", () => {
    for (const status of [
      "DRAFT",
      "QUEUED",
      "SENDING",
      "SENT",
      "DELIVERED",
      "READ",
      "FAILED",
      "CANCELLED",
    ]) {
      expect(deliveryStatusSchema.parse(status)).toBe(status);
    }
  });

  it("status schema rejects unknown statuses", () => {
    for (const bad of ["sent", "PENDING", "APPROVED", "", null]) {
      expect(deliveryStatusSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("outboundMessageSchema", () => {
  it("accepts a minimal text message", () => {
    expect(outboundMessageSchema.parse({ type: "text", text: "Olá!" })).toEqual({
      type: "text",
      text: "Olá!",
    });
  });

  it("rejects an empty text", () => {
    expect(outboundMessageSchema.safeParse({ type: "text", text: "" }).success).toBe(false);
    expect(outboundMessageSchema.safeParse({ type: "text", text: "   " }).success).toBe(false);
  });

  it("rejects text above 4096 chars", () => {
    expect(outboundMessageSchema.safeParse({ type: "text", text: "a".repeat(4097) }).success).toBe(
      false,
    );
    expect(outboundMessageSchema.safeParse({ type: "text", text: "a".repeat(4096) }).success).toBe(
      true,
    );
  });

  it("accepts a template message with language and no components", () => {
    const parsed = outboundMessageSchema.parse({
      type: "template",
      templateName: "order_update",
      language: "pt_BR",
    });
    expect(parsed).toEqual({ type: "template", templateName: "order_update", language: "pt_BR" });
  });

  it("accepts a template with body text parameters", () => {
    const parsed = outboundMessageSchema.parse({
      type: "template",
      templateName: "promo_week",
      language: "pt-BR",
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
    });
    expect(parsed.type).toBe("template");
    if (parsed.type === "template") {
      expect(parsed.components).toHaveLength(1);
    }
  });

  it("accepts currency and date_time parameters", () => {
    const parsed = outboundMessageSchema.parse({
      type: "template",
      templateName: "invoice_ready",
      language: "en_US",
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "currency",
              currency: { fallback_value: "R$ 10,00", code: "BRL", amount_1000: 10_000 },
            },
            { type: "date_time", date_time: { fallback_value: "23/09/2026" } },
          ],
        },
      ],
    });
    expect(parsed.type).toBe("template");
  });

  it("rejects invalid template names", () => {
    for (const name of ["Promo", "hello world", "t-nome", "", "NOME"]) {
      expect(
        outboundMessageSchema.safeParse({ type: "template", templateName: name, language: "pt_BR" })
          .success,
      ).toBe(false);
    }
  });

  it("rejects invalid language codes", () => {
    for (const lang of ["", "P", "pt_br_x", "pt-BRX", "123"]) {
      expect(
        outboundMessageSchema.safeParse({
          type: "template",
          templateName: "valid_name",
          language: lang,
        }).success,
      ).toBe(false);
    }
    for (const lang of ["pt", "pt_BR", "pt-BR", "en_US"]) {
      expect(
        outboundMessageSchema.safeParse({
          type: "template",
          templateName: "valid_name",
          language: lang,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects unknown message types", () => {
    expect(outboundMessageSchema.safeParse({ type: "image", url: "x" }).success).toBe(false);
    expect(outboundMessageSchema.safeParse({ type: "audio" }).success).toBe(false);
    expect(outboundMessageSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a component without parameters", () => {
    expect(
      outboundMessageSchema.safeParse({
        type: "template",
        templateName: "x_valid",
        language: "pt_BR",
        components: [{ type: "body", parameters: [] }],
      }).success,
    ).toBe(false);
  });
});

describe("commerceExecutionDeliverySchema", () => {
  const base = {
    organizationId: "org_1",
    executionId: "exec-1",
    status: "APPROVED",
    channel: "WHATSAPP",
    recipientId: "+5511999990000",
    message: { type: "text", text: "Olá" },
  };

  it("accepts a minimal approved execution", () => {
    const parsed = commerceExecutionDeliverySchema.parse(base);
    expect(parsed.organizationId).toBe("org_1");
    expect(parsed.campaignId).toBeUndefined();
  });

  it("accepts denormalized campaign and creator context", () => {
    const parsed = commerceExecutionDeliverySchema.parse({
      ...base,
      campaignId: "camp-1",
      campaignName: "Lançamento",
      creatorId: "c1",
      creatorName: "Ana",
      recipientName: "Ana",
    });
    expect(parsed.campaignName).toBe("Lançamento");
    expect(parsed.creatorName).toBe("Ana");
  });

  it("accepts explicit nulls for optional context", () => {
    const parsed = commerceExecutionDeliverySchema.parse({ ...base, campaignId: null });
    expect(parsed.campaignId).toBeNull();
  });

  it("rejects missing organizationId", () => {
    expect(commerceExecutionDeliverySchema.safeParse({ ...base, organizationId: "" }).success).toBe(
      false,
    );
    expect(
      commerceExecutionDeliverySchema.safeParse({ ...base, organizationId: "  " }).success,
    ).toBe(false);
  });

  it("rejects missing executionId", () => {
    expect(commerceExecutionDeliverySchema.safeParse({ ...base, executionId: "" }).success).toBe(
      false,
    );
  });

  it("rejects missing recipientId", () => {
    expect(commerceExecutionDeliverySchema.safeParse({ ...base, recipientId: "" }).success).toBe(
      false,
    );
  });

  it("rejects unknown channels inside an execution", () => {
    expect(commerceExecutionDeliverySchema.safeParse({ ...base, channel: "SMS" }).success).toBe(
      false,
    );
  });

  it("rejects invalid nested messages", () => {
    expect(
      commerceExecutionDeliverySchema.safeParse({ ...base, message: { type: "text", text: "" } })
        .success,
    ).toBe(false);
  });

  it("the validator does NOT gate APPROVED (dispatcher owns that decision)", () => {
    expect(commerceExecutionDeliverySchema.safeParse({ ...base, status: "PENDING" }).success).toBe(
      true,
    );
  });
});

describe("sendDeliverySchema (manual send)", () => {
  const base = {
    channel: "INSTAGRAM",
    recipientId: "ig-user-123",
    message: { type: "text", text: "Parabéns!" },
  };

  it("accepts a minimal manual send", () => {
    expect(sendDeliverySchema.parse(base).channel).toBe("INSTAGRAM");
  });

  it("rejects a missing recipient", () => {
    expect(sendDeliverySchema.safeParse({ ...base, recipientId: "" }).success).toBe(false);
  });

  it("accepts optional name and campaign context", () => {
    const parsed = sendDeliverySchema.parse({
      ...base,
      recipientName: "Ana",
      campaignId: "c1",
      campaignName: "Campanha X",
    });
    expect(parsed.campaignName).toBe("Campanha X");
  });

  it("accepts template sends for WhatsApp", () => {
    const parsed = sendDeliverySchema.parse({
      channel: "WHATSAPP",
      recipientId: "+5511999990000",
      message: { type: "template", templateName: "welcome_v1", language: "pt_BR" },
    });
    expect(parsed.message.type).toBe("template");
  });
});

describe("misc action schemas", () => {
  it("disconnectDeliveryAccountSchema requires an account pk", () => {
    expect(disconnectDeliveryAccountSchema.safeParse({ accountPk: "a1" }).success).toBe(true);
    expect(disconnectDeliveryAccountSchema.safeParse({ accountPk: "" }).success).toBe(false);
    expect(disconnectDeliveryAccountSchema.safeParse({}).success).toBe(false);
  });

  it("deliveryMessageIdSchema requires an id", () => {
    expect(deliveryMessageIdSchema.safeParse({ messageId: "m1" }).success).toBe(true);
    expect(deliveryMessageIdSchema.safeParse({ messageId: " " }).success).toBe(false);
  });

  it("deliveryOAuthCallbackSchema accepts code+state", () => {
    expect(deliveryOAuthCallbackSchema.safeParse({ code: "abc", state: "xyz" }).success).toBe(true);
  });

  it("deliveryOAuthCallbackSchema rejects missing params", () => {
    expect(deliveryOAuthCallbackSchema.safeParse({ code: "", state: "x" }).success).toBe(false);
    expect(deliveryOAuthCallbackSchema.safeParse({ code: "x" }).success).toBe(false);
    expect(deliveryOAuthCallbackSchema.safeParse({}).success).toBe(false);
  });
});

describe("deliveryFiltersSchema (dashboard)", () => {
  it("applies defaults", () => {
    const parsed = deliveryFiltersSchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(parsed.channel).toBeUndefined();
    expect(parsed.status).toBeUndefined();
    expect(parsed.campaignId).toBeUndefined();
  });

  it("keeps valid channel/status values", () => {
    const parsed = deliveryFiltersSchema.parse({ channel: "INSTAGRAM", status: "READ" });
    expect(parsed.channel).toBe("INSTAGRAM");
    expect(parsed.status).toBe("READ");
  });

  it("drops invalid channel/status instead of failing", () => {
    const parsed = deliveryFiltersSchema.parse({ channel: "MYSPACE", status: "BOGUS" });
    expect(parsed.channel).toBeUndefined();
    expect(parsed.status).toBeUndefined();
  });

  it("coerces page and pageSize from strings", () => {
    const parsed = deliveryFiltersSchema.parse({ page: "3", pageSize: "50" });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(50);
  });

  it("clamps pageSize above the maximum", () => {
    expect(deliveryFiltersSchema.safeParse({ pageSize: 500 }).success).toBe(false);
    expect(deliveryFiltersSchema.parse({ pageSize: 100 }).pageSize).toBe(100);
  });

  it("drops empty campaign ids", () => {
    expect(deliveryFiltersSchema.parse({ campaignId: "" }).campaignId).toBeUndefined();
    expect(deliveryFiltersSchema.parse({ campaignId: "c1" }).campaignId).toBe("c1");
  });

  it("rejects non-positive pages", () => {
    expect(deliveryFiltersSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(deliveryFiltersSchema.safeParse({ page: -2 }).success).toBe(false);
  });
});
