import type { CreatorRecommendation } from "../matching/matcher";

export type SaveAudienceItem = Pick<
  CreatorRecommendation,
  "campaignId" | "creatorId" | "productId" | "matchScore" | "recommended"
>;

export interface CampaignDashboardKpis {
  recommendedCreators: number;
  products: number;
  averageScore: number;
  predictedRoi: number;
}
