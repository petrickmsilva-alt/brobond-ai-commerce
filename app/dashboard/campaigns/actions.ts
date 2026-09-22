"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/session";
import { buildCampaign } from "@/modules/campaigns/builder/campaign.service";
import { campaignIdSchema } from "@/modules/campaigns/validators/campaign.validator";

export async function rebuildCampaignAudience(input: unknown) {
  const { organizationId } = await requireManager();
  const { campaignId } = campaignIdSchema.parse(input);
  const audience = await buildCampaign(organizationId, campaignId);
  revalidatePath("/dashboard/campaigns");
  return { ok: audience !== null, count: audience?.length ?? 0 };
}
