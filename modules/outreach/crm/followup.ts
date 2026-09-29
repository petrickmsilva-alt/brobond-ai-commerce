import type { CreateMessageDTO } from "../dto/create-message.dto";
import { generateOutreachMessage } from "../prompts/generator";
import type { GenerateOutreachInput } from "../interfaces/outreach.interface";

export const FOLLOW_UP_DAYS = [0, 3, 7, 15] as const;

export interface FollowUpTemplate {
  id: string;
  content: string;
  daysAfter: number;
}

export interface GenerateFollowUpInput extends Omit<
  CreateMessageDTO,
  "templateId" | "generatedText"
> {
  context: Omit<GenerateOutreachInput, "template">;
  firstContact: FollowUpTemplate;
  followUps: readonly FollowUpTemplate[];
}

export interface FollowUpDraft {
  data: CreateMessageDTO;
  scheduledFor: Date;
  daysAfter: number;
}

/**
 * Build the 1st-contact/+3/+7/+15 cadence as DRAFT payloads. Scheduling is
 * informational only: callers persist with createDraft, never transmit.
 */
export function generateFollowUp(
  input: GenerateFollowUpInput,
  startsAt = new Date(),
): FollowUpDraft[] {
  const byDay = new Map(input.followUps.map((step) => [step.daysAfter, step]));
  byDay.set(0, input.firstContact);

  return FOLLOW_UP_DAYS.map((daysAfter) => {
    const selected = byDay.get(daysAfter);
    if (!selected) throw new Error(`Missing follow-up template for day ${daysAfter}.`);
    const scheduledFor = new Date(startsAt);
    scheduledFor.setUTCDate(scheduledFor.getUTCDate() + daysAfter);
    return {
      daysAfter,
      scheduledFor,
      data: {
        creatorId: input.creatorId,
        productId: input.productId,
        campaignId: input.campaignId,
        createdById: input.createdById,
        templateId: selected.id,
        generatedText: generateOutreachMessage({
          ...input.context,
          template: selected.content,
        }),
      },
    };
  });
}

/** Persist a generated cadence through an injected tenant-aware repository. */
export async function persistFollowUpDrafts(
  organizationId: string,
  drafts: readonly FollowUpDraft[],
  createDraft: (organizationId: string, data: CreateMessageDTO) => Promise<unknown>,
): Promise<unknown[]> {
  const created: unknown[] = [];
  for (const draft of drafts) created.push(await createDraft(organizationId, draft.data));
  return created;
}
