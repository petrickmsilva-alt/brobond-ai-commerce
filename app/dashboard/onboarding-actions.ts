"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/lib/rbac";
import { requireOrganization } from "@/lib/session";
import { onboardingService } from "@/modules/auth/onboarding.service";

/**
 * Onboarding checklist actions (PR010.4 §9).
 *
 * TENANT: `requireOrganization()` is the first statement, and its return value
 * is the ONLY organization id the service ever sees. The client sends no
 * payload at all, so there is nothing here for a caller to point at another
 * workspace.
 *
 * RBAC: deliberately not ADMIN-gated. Dismissing a first-run panel is a
 * per-workspace display preference, not a privileged operation — requiring
 * ADMIN would leave a MEMBER staring at a checklist they cannot act on or
 * close.
 */

export type OnboardingActionResult = { ok: true } | { ok: false; error: string };

export async function dismissOnboardingAction(): Promise<OnboardingActionResult> {
  try {
    const organizationId = await requireOrganization();
    await onboardingService.dismiss(organizationId);

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: "Sua sessão expirou. Entre novamente." };
    }
    console.error("[onboarding.dismiss]", error);
    return { ok: false, error: "Não foi possível dispensar o guia. Tente novamente." };
  }
}
