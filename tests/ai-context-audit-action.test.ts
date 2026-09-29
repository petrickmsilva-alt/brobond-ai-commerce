import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";

const requireUserMock = vi.hoisted(() => vi.fn());
const requireOrganizationMock = vi.hoisted(() => vi.fn());
const findWithContextMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({
  requireUser: requireUserMock,
  requireOrganization: requireOrganizationMock,
  requireManager: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/ai/repositories/ai-message.repository", () => ({
  aiMessageRepository: { findWithContext: findWithContextMock },
}));
vi.mock("@/modules/ai/personalization/message.service", () => ({
  aiMessageService: { generate: vi.fn() },
  readGeneratedContent: (message: { content: unknown }) => message.content,
}));

const { getAiMessageContextAction } = await import("@/app/dashboard/ai/actions");

const snapshot = {
  creator: { id: "creator_1", name: "Ana Souza", handle: "ana.souza", niche: "Moda", score: 82 },
  product: { id: "product_1", name: "Jaqueta Bomber", margin: 3550 },
  campaign: { id: "campaign_1", name: "Lançamento Inverno" },
  trend: { keyword: "streetwear", score: 87 },
};

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    promptVersion: "friendly@1.0.0",
    model: "gpt-4o-mini",
    temperature: 0.7,
    inputTokens: 100,
    outputTokens: 50,
    contextHash: "a".repeat(64),
    contextSnapshot: snapshot,
    creatorProfile: { displayName: "Ana (renomeada)" },
    product: { name: "Jaqueta (v2)" },
    campaign: { name: "Campanha atual" },
    ...overrides,
  };
}

describe("getAiMessageContextAction() — PR007.1", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    requireOrganizationMock.mockReset();
    findWithContextMock.mockReset();
    revalidatePathMock.mockReset();

    requireUserMock.mockResolvedValue({ id: "user_1", organizationId: "org_a" });
    requireOrganizationMock.mockResolvedValue("org_a");
    findWithContextMock.mockResolvedValue(messageRow());
  });

  it("rejects an unauthenticated caller", async () => {
    requireUserMock.mockRejectedValue(new AuthorizationError("Unauthorized", 401));
    const result = await getAiMessageContextAction("msg_1");
    expect(result.ok).toBe(false);
    expect(findWithContextMock).not.toHaveBeenCalled();
  });

  it("rejects a caller without an organization", async () => {
    requireOrganizationMock.mockRejectedValue(new AuthorizationError("Forbidden", 403));
    const result = await getAiMessageContextAction("msg_1");
    expect(result.ok).toBe(false);
    expect(findWithContextMock).not.toHaveBeenCalled();
  });

  it("rejects a blank message id", async () => {
    const result = await getAiMessageContextAction("   ");
    expect(result.ok).toBe(false);
    expect(findWithContextMock).not.toHaveBeenCalled();
  });

  it("scopes the repository lookup to the caller's organization", async () => {
    await getAiMessageContextAction("msg_1");
    expect(findWithContextMock).toHaveBeenCalledWith("org_a", "msg_1");
  });

  it("fails cleanly when the message does not exist in the tenant", async () => {
    findWithContextMock.mockResolvedValue(null);
    const result = await getAiMessageContextAction("msg_other");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns snapshot-first context names plus generation metadata", async () => {
    const result = await getAiMessageContextAction("msg_1");
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      id: "msg_1",
      creator: "Ana Souza",
      product: "Jaqueta Bomber",
      campaign: "Lançamento Inverno",
      trend: "streetwear",
      promptVersion: "friendly@1.0.0",
      model: "gpt-4o-mini",
      temperature: 0.7,
      inputTokens: 100,
      outputTokens: 50,
      contextHash: "a".repeat(64),
      snapshotAvailable: true,
    });
    expect(result.data?.snapshot).toEqual(snapshot);
  });

  it("falls back to the related record names for pre-PR007.1 rows (null snapshot)", async () => {
    findWithContextMock.mockResolvedValue(messageRow({ contextSnapshot: null }));
    const result = await getAiMessageContextAction("msg_1");
    expect(result.ok).toBe(true);
    expect(result.data?.snapshotAvailable).toBe(false);
    expect(result.data?.snapshot).toBeNull();
    expect(result.data?.creator).toBe("Ana (renomeada)");
    expect(result.data?.product).toBe("Jaqueta (v2)");
    expect(result.data?.campaign).toBe("Campanha atual");
    expect(result.data?.trend).toBeNull();
  });

  it("exposes trend as null when the snapshot has no trend", async () => {
    findWithContextMock.mockResolvedValue(
      messageRow({ contextSnapshot: { ...snapshot, trend: null } }),
    );
    const result = await getAiMessageContextAction("msg_1");
    expect(result.ok).toBe(true);
    expect(result.data?.trend).toBeNull();
    expect(result.data?.snapshotAvailable).toBe(true);
  });

  it("is read-only — never revalidates the dashboard path", async () => {
    await getAiMessageContextAction("msg_1");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
