"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, Rocket, X } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { Badge } from "@/components/ui/badge";
import { dismissOnboardingAction } from "@/app/dashboard/onboarding-actions";
import type { OnboardingStepView } from "@/modules/auth/onboarding.service";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";

/**
 * First-run onboarding checklist (PR010.4 §9).
 *
 * "Após primeiro login, exibir onboarding: Conectar TikTok · Importar
 * Produtos · Criar Creator · Criar Campanha."
 *
 * WHY THIS IS THE FIRST THING ON THE DASHBOARD
 * --------------------------------------------
 * A tenant created thirty seconds ago has no GMV, no orders, no creators and
 * no campaigns. Without this panel, the first thing a brand-new ADMIN sees is
 * six KPI cards reading zero — a dashboard that looks broken rather than
 * empty. The checklist turns that silence into the four things they should
 * actually do next, in the order that makes them work.
 *
 * WHAT IT SHOWS
 * -------------
 * Each step is ticked from LIVE tenant counts (see `onboarding.service.ts`),
 * never from a stored flag, so it can never disagree with reality. The panel
 * disappears on its own once all four are done.
 *
 * ACCESSIBILITY: the steps are an ordered list with per-item state announced
 * in text ("Concluído"), not by colour alone; the dismiss button is a labelled
 * control, not an icon with no name.
 */

export interface OnboardingChecklistProps {
  steps: OnboardingStepView[];
  completed: number;
  total: number;
}

export function OnboardingChecklist({ steps, completed, total }: OnboardingChecklistProps) {
  const router = useRouter();
  const [dismissing, setDismissing] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);

  if (hidden) return null;

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  async function dismiss() {
    setDismissing(true);
    const result = await dismissOnboardingAction();
    if (result.ok) {
      setHidden(true);
      router.refresh();
      return;
    }
    // A failed dismissal must not silently hide the panel — leaving it visible
    // is the honest outcome, and the user can simply try again.
    setDismissing(false);
  }

  return (
    <SectionCard
      data-testid="onboarding-checklist"
      title="Comece por aqui"
      description="Quatro passos para deixar seu workspace operacional."
      icon={Rocket}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={completed === total ? "success" : "brand"}>
            {completed} de {total}
          </Badge>
          <button
            type="button"
            onClick={dismiss}
            disabled={dismissing}
            aria-label="Dispensar o guia de primeiros passos"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg text-white/40",
              "transition-colors hover:bg-white/[0.06] hover:text-white/70 disabled:opacity-50",
              focusRingRaised,
            )}
          >
            {dismissing ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <X aria-hidden className="h-4 w-4" />
            )}
          </button>
        </div>
      }
    >
      {/* Progress — the number is also in the badge, so this bar is decorative. */}
      <div aria-hidden className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.id}>
            <Link
              href={step.href}
              data-testid={`onboarding-step-${step.id}`}
              className={cn(
                "group flex h-full items-start gap-3 rounded-xl border px-4 py-3.5 transition-[border-color,background-color,transform]",
                "hover:-translate-y-0.5",
                step.done
                  ? "border-emerald-400/25 bg-emerald-500/[0.06]"
                  : "border-white/8 bg-white/[0.02] hover:border-white/16",
                focusRingRaised,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                  step.done
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "border border-white/10 bg-white/[0.04] text-white/50",
                )}
              >
                {step.done ? <Check className="h-4 w-4" /> : index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      step.done ? "text-white/60 line-through" : "text-white",
                    )}
                  >
                    {step.title}
                  </span>
                  {step.done && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-300/80">
                      Concluído
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-white/45">
                  {step.description}
                </span>
              </span>

              {!step.done && (
                <ArrowRight
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-white/25 transition-colors group-hover:text-brand-300"
                />
              )}
            </Link>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
