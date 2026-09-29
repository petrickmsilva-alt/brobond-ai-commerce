import { describe, expect, it, vi } from "vitest";
import {
  createCampaignAudienceRepository,
  type AudienceDatabase,
} from "@/modules/campaigns/repositories/campaign-audience.repository";

function database(overrides: Record<string, unknown> = {}) {
  const db = {
    campaign: { findFirst: vi.fn().mockResolvedValue({ id: "campaign", organizationId: "org-a" }) },
    creatorProfile: { findMany: vi.fn().mockResolvedValue([{ id: "creator" }]) },
    product: { findMany: vi.fn().mockResolvedValue([{ id: "product" }]) },
    campaignAudience: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
  return db as unknown as AudienceDatabase;
}

const item = {
  campaignId: "campaign",
  creatorId: "creator",
  productId: "product",
  matchScore: 88,
  recommended: true,
};

describe("campaign audience repository", () => {
  it("requires a non-empty organization on every operation", async () => {
    const repository = createCampaignAudienceRepository(database());
    expect(() => repository.listAudience(" ")).toThrow(/organization scope/i);
    expect(() => repository.listRecommendations("")).toThrow(/organization scope/i);
    await expect(repository.saveAudience("", "campaign", [item])).rejects.toMatchObject({
      status: 403,
    });
  });
  it("scopes audience reads by organization", async () => {
    const db = database();
    await createCampaignAudienceRepository(db).listAudience("org-a", "campaign");
    expect(db.campaignAudience.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", campaignId: "campaign" } }),
    );
  });
  it("scopes recommendations and forces recommended=true", async () => {
    const db = database();
    await createCampaignAudienceRepository(db).listRecommendations("org-a");
    expect(db.campaignAudience.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recommended: true, organizationId: "org-a" } }),
    );
  });
  it("refuses to write to a campaign outside the tenant", async () => {
    const db = database({ campaign: { findFirst: vi.fn().mockResolvedValue(null) } });
    const result = await createCampaignAudienceRepository(db).saveAudience("org-a", "foreign", [
      item,
    ]);
    expect(result).toEqual([]);
    expect(db.campaignAudience.createMany).not.toHaveBeenCalled();
  });
  it("checks creator and product ownership before replacing the audience", async () => {
    const db = database({ creatorProfile: { findMany: vi.fn().mockResolvedValue([]) } });
    await createCampaignAudienceRepository(db).saveAudience("org-a", "campaign", [item]);
    expect(db.campaignAudience.deleteMany).not.toHaveBeenCalled();
    expect(db.campaignAudience.createMany).not.toHaveBeenCalled();
  });
  it("deduplicates pairs and clamps persisted scores", async () => {
    const db = database();
    await createCampaignAudienceRepository(db).saveAudience("org-a", "campaign", [
      { ...item, matchScore: 999 },
      item,
    ]);
    expect(db.campaignAudience.createMany).toHaveBeenCalledWith({
      data: [{ ...item, organizationId: "org-a", matchScore: 88 }],
    });
  });
});
