import { describe, expect, it, vi } from "vitest";
import {
  FOLLOW_UP_DAYS,
  generateFollowUp,
  persistFollowUpDrafts,
} from "@/modules/outreach/crm/followup";

const input = {
  creatorId: "creator_1",
  productId: "product_1",
  campaignId: "campaign_1",
  createdById: "user_1",
  context: {
    creator: { displayName: "Ana", niche: "Moda" },
    product: { name: "Hoodie" },
    campaign: { name: "Launch" },
    trend: { keyword: "streetwear" },
  },
  firstContact: { id: "first", daysAfter: 0, content: "Olá {{creatorName}} — {{productName}}" },
  followUps: [3, 7, 15].map((daysAfter) => ({
    id: `follow_${daysAfter}`,
    daysAfter,
    content: `Follow ${daysAfter}: {{campaignName}} / {{trendKeyword}}`,
  })),
};

describe("Follow-up cadence", () => {
  it("uses the required cadence", () => expect(FOLLOW_UP_DAYS).toEqual([0, 3, 7, 15]));
  it("generates four drafts", () => expect(generateFollowUp(input)).toHaveLength(4));
  it("keeps every payload as a draft-ready DTO (without status override)", () => {
    for (const draft of generateFollowUp(input)) expect(draft.data).not.toHaveProperty("status");
  });
  it("selects the first-contact template on day zero", () => {
    expect(generateFollowUp(input)[0]?.data.templateId).toBe("first");
  });
  it.each([3, 7, 15])("selects the configured template on day %i", (day) => {
    expect(generateFollowUp(input).find((draft) => draft.daysAfter === day)?.data.templateId).toBe(
      `follow_${day}`,
    );
  });
  it("calculates dates in UTC without mutating startsAt", () => {
    const start = new Date("2026-09-22T10:30:00.000Z");
    const drafts = generateFollowUp(input, start);
    expect(start.toISOString()).toBe("2026-09-22T10:30:00.000Z");
    expect(drafts.map((draft) => draft.scheduledFor.toISOString())).toEqual([
      "2026-09-22T10:30:00.000Z",
      "2026-09-25T10:30:00.000Z",
      "2026-09-29T10:30:00.000Z",
      "2026-10-07T10:30:00.000Z",
    ]);
  });
  it("uses the prompt engine for each draft", () => {
    const drafts = generateFollowUp(input);
    expect(drafts[0]?.data.generatedText).toContain("Ana");
    expect(drafts[1]?.data.generatedText).toContain("Launch / streetwear");
  });
  it("fails closed if one required cadence template is absent", () => {
    expect(() => generateFollowUp({ ...input, followUps: input.followUps.slice(0, 2) })).toThrow(
      "day 15",
    );
  });
  it("persists in cadence order and always passes the tenant", async () => {
    const create = vi.fn(async (_organizationId: string, _data: unknown) => ({ id: "ok" }));
    const drafts = generateFollowUp(input);
    await expect(persistFollowUpDrafts("org_a", drafts, create)).resolves.toHaveLength(4);
    expect(create).toHaveBeenCalledTimes(4);
    expect(create.mock.calls.every(([organizationId]) => organizationId === "org_a")).toBe(true);
  });
});
