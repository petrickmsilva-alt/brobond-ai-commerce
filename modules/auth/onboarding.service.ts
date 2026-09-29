import "server-only";

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantWhere } from "@/lib/tenant";
import {
  ONBOARDING_STEPS,
  countCompletedSteps,
  deriveOnboardingProgress,
  isOnboardingComplete,
  type OnboardingProgress,
} from "./tenant-provisioning";

/**
 * First-run onboarding read model (PR010.4 §9).
 *
 * "Após primeiro login, exibir onboarding: Conectar TikTok · Importar
 * Produtos · Criar Creator · Criar Campanha."
 *
 * WHY IT IS DERIVED AND NOT STORED
 * --------------------------------
 * A stored checklist drifts: a user imports products through the TikTok
 * importer, and a boolean nobody remembered to flip leaves the step
 * un-ticked forever. Here each step is answered by counting the thing it asks
 * for, so the checklist is always telling the truth — and a tenant that
 * completes a step by any route sees it tick.
 *
 * `Organization.onboardingCompletedAt` is only a DISMISSAL marker: it hides
 * the panel once everything is done (or once the user dismisses it), and it
 * never contradicts the live counts.
 *
 * TENANCY: every count goes through `tenantWhere()`. The checklist of one
 * workspace can never be computed from another's rows.
 */

export type OnboardingDatabase = Pick<
  PrismaClient,
  "organization" | "product" | "creatorProfile" | "campaign" | "tikTokAccount"
>;

export interface OnboardingStepView {
  id: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
}

export interface OnboardingState {
  /** Whether `/dashboard` should render the checklist at all. */
  visible: boolean;
  steps: OnboardingStepView[];
  completed: number;
  total: number;
  /** Every step done. */
  finished: boolean;
  progress: OnboardingProgress;
}

export function createOnboardingService(db: OnboardingDatabase) {
  return {
    /** Live checklist state for one tenant. */
    async getState(organizationId: string): Promise<OnboardingState> {
      const scope = tenantWhere(organizationId);

      const [organization, products, creators, campaigns, tiktokAccounts] = await Promise.all([
        db.organization.findUnique({
          where: { id: scope.organizationId },
          select: { onboardingCompletedAt: true },
        }),
        db.product.count({ where: scope }),
        db.creatorProfile.count({ where: scope }),
        db.campaign.count({ where: scope }),
        db.tikTokAccount.count({ where: scope }),
      ]);

      const progress = deriveOnboardingProgress({
        products,
        creators,
        campaigns,
        tiktokAccounts,
      });

      const completed = countCompletedSteps(progress);
      const finished = isOnboardingComplete(progress);

      return {
        // Hidden once the tenant finished (or explicitly dismissed) onboarding.
        visible: !organization?.onboardingCompletedAt && !finished,
        steps: ONBOARDING_STEPS.map((step) => ({
          id: step.id,
          title: step.title,
          description: step.description,
          href: step.href,
          done: progress[step.id],
        })),
        completed,
        total: ONBOARDING_STEPS.length,
        finished,
        progress,
      };
    },

    /**
     * Dismiss the checklist for this tenant.
     *
     * Idempotent: a second dismissal keeps the original timestamp, so the
     * record of when a workspace stopped being brand-new stays accurate.
     */
    async dismiss(organizationId: string, now: Date = new Date()): Promise<void> {
      const scope = tenantWhere(organizationId);
      const existing = await db.organization.findUnique({
        where: { id: scope.organizationId },
        select: { onboardingCompletedAt: true },
      });
      if (existing?.onboardingCompletedAt) return;

      await db.organization.update({
        where: { id: scope.organizationId },
        data: { onboardingCompletedAt: now },
      });
    },
  };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;

/** Production instance bound to the shared Prisma client. */
export const onboardingService = createOnboardingService(prisma);
