import type { GenerateOutreachInput } from "../interfaces/outreach.interface";
import { DEFAULT_OUTREACH_TEMPLATE } from "./templates";
import { replaceVariables } from "./variables";

/**
 * Deterministic template-based outreach generator.
 * Deliberately performs no network call and uses no OpenAI/provider SDK.
 */
export function generateOutreachMessage({
  creator,
  product,
  campaign,
  trend,
  template = DEFAULT_OUTREACH_TEMPLATE.content,
}: GenerateOutreachInput): string {
  return replaceVariables(template, {
    creatorName: creator.displayName,
    niche: creator.niche,
    productName: product.name,
    campaignName: campaign.name,
    trendKeyword: trend.keyword,
  });
}
