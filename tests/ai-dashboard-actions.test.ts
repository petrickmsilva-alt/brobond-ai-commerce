import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";

const requireManagerMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const generateMock = vi.hoisted(() => vi.fn());

const creatorFindFirst = vi.hoisted(() => vi.fn());
const productFindFirst = vi.hoisted(() => vi.fn());
const campaignFindFirst = vi.hoisted(() => vi.fn());
const trendFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({
  requireManager: requireManagerMock,
  // PR007.1 — extra guards imported by app/dashboard/ai/actions.ts for the
  // context-audit action; stubbed here so this suite stays focused on
  // generateAiMessageAction().
  requireUser: vi.fn(),
  requireOrganization: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    creatorProfile: { findFirst: creatorFindFirst },
    product: { findFirst: productFindFirst },
    campaign: { findFirst: campaignFindFirst },
    trendSnapshot: { findFirst: trendFindFirst },
  },
}));
vi.mock("@/modules/ai/personalization/message.service", () => ({
  aiMessageService: { generate: generateMock },
  readGeneratedContent: (message: { content: unknown }) => message.content,
}));

const { generateAiMessageAction } = await import("@/app/dashboard/ai/actions");

const validInput = {
  creatorId: "creator_1",
  productId: "product_1",
  campaignId: "campaign_1",
  tone: "FRIENDLY",
};

const manager = {
  id: "user_1",
  email: "manager@brobond.ai",
  name: "Manager",
  image: null,
  role: "MANAGER",
  organizationId: "org_a",
};

describe("generateAiMessageAction()", () => {
  beforeEach(() => {
    requireManagerMock.mockReset();
    revalidatePathMock.mockReset();
    generateMock.mockReset();
    creatorFindFirst.mockReset();
    productFindFirst.mockReset();
    campaignFindFirst.mockReset();
    trendFindFirst.mockReset();

    requireManagerMock.mockResolvedValue(manager);
    creatorFindFirst.mockResolvedValue({
      id: "creator_1",
      displayName: "Ana",
      handle: "ana",
      niche: "Moda",
      engagementRate: 5,
      avgViews: 1000,
    });
    productFindFirst.mockResolvedValue({
      id: "product_1",
      name: "Produto",
      description: null,
      priceCents: 1000,
    });
    campaignFindFirst.mockResolvedValue({ id: "campaign_1", name: "Campanha" });
    trendFindFirst.mockResolvedValue(null);
    generateMock.mockResolvedValue({
      cached: false,
      message: {
        id: "msg_1",
        content: { title: "T", message: "M", hashtags: ["#a"], cta: "c" },
        promptVersion: "friendly@1.0.0",
        model: "gpt-4o-mini",
        inputTokens: 10,
        outputTokens: 5,
      },
    });
  });

  it("rejects an unauthenticated / insufficiently privileged caller", async () => {
    requireManagerMock.mockRejectedValue(new AuthorizationError("Forbidden", 403));
    const result = await generateAiMessageAction(validInput);
    expect(result.ok).toBe(false);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload with field errors", async () => {
    const result = await generateAiMessageAction({ ...validInput, tone: "INVALID" });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toBeDefined();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("fails when the creator does not belong to the caller's tenant", async () => {
    creatorFindFirst.mockResolvedValue(null);
    const result = await generateAiMessageAction(validInput);
    expect(result.ok).toBe(false);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("fails when the product is not found", async () => {
    productFindFirst.mockResolvedValue(null);
    const result = await generateAiMessageAction(validInput);
    expect(result.ok).toBe(false);
  });

  it("fails when the campaign is not found", async () => {
    campaignFindFirst.mockResolvedValue(null);
    const result = await generateAiMessageAction(validInput);
    expect(result.ok).toBe(false);
  });

  it("scopes every lookup to the caller's organizationId", async () => {
    await generateAiMessageAction(validInput);
    expect(creatorFindFirst).toHaveBeenCalledWith({
      where: { id: "creator_1", organizationId: "org_a" },
    });
    expect(productFindFirst).toHaveBeenCalledWith({
      where: { id: "product_1", organizationId: "org_a" },
    });
    expect(campaignFindFirst).toHaveBeenCalledWith({
      where: { id: "campaign_1", organizationId: "org_a" },
    });
  });

  it("calls the AI service with the resolved context and returns its content", async () => {
    const result = await generateAiMessageAction(validInput);
    expect(result.ok).toBe(true);
    expect(result.data?.content).toEqual({ title: "T", message: "M", hashtags: ["#a"], cta: "c" });
    expect(result.data?.cached).toBe(false);
    expect(generateMock).toHaveBeenCalledWith(
      "org_a",
      expect.objectContaining({ tone: "FRIENDLY", creatorUserId: "user_1" }),
    );
  });

  it("passes trend data through when a trend snapshot exists", async () => {
    trendFindFirst.mockResolvedValue({ keyword: "streetwear", category: "Moda", trendScore: 90 });
    await generateAiMessageAction(validInput);
    expect(generateMock).toHaveBeenCalledWith(
      "org_a",
      expect.objectContaining({
        trend: { keyword: "streetwear", category: "Moda", score: 90 },
      }),
    );
  });

  it("passes a null trend when no snapshot exists", async () => {
    await generateAiMessageAction(validInput);
    expect(generateMock).toHaveBeenCalledWith("org_a", expect.objectContaining({ trend: null }));
  });

  it("revalidates the /dashboard/ai path on success", async () => {
    await generateAiMessageAction(validInput);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/ai");
  });

  it("does not revalidate on failure", async () => {
    creatorFindFirst.mockResolvedValue(null);
    await generateAiMessageAction(validInput);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("surfaces cached=true without erroring when the service reuses a cached message", async () => {
    generateMock.mockResolvedValue({
      cached: true,
      message: {
        id: "msg_1",
        content: { title: "T", message: "M", hashtags: [], cta: "c" },
        promptVersion: "friendly@1.0.0",
        model: "gpt-4o-mini",
        inputTokens: 10,
        outputTokens: 5,
      },
    });
    const result = await generateAiMessageAction(validInput);
    expect(result.ok).toBe(true);
    expect(result.data?.cached).toBe(true);
  });
});
