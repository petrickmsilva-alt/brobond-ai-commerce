"use client";

import { useState, useTransition } from "react";
import { CircleAlert, CircleCheck, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { collectDailyTrendsAction } from "@/app/dashboard/trends/actions";

/**
 * Manual trigger for the `collect-daily-trends` scheduler job.
 * Rendered for ADMIN only (the action re-asserts `requireAdmin()`).
 *
 * There is no cron in PR002 — this button is the only trigger.
 */
export function CollectTrendsButton() {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { ok: true; message: string } | { ok: false; message: string } | null
  >(null);

  function run() {
    setFeedback(null);
    startTransition(async () => {
      const result = await collectDailyTrendsAction();
      if (result.ok) {
        const { snapshotsCreated, topKeyword, topScore } = result.data;
        setFeedback({
          ok: true,
          message: `${snapshotsCreated} tendências coletadas · top: "${topKeyword}" (${topScore}/100).`,
        });
      } else {
        setFeedback({ ok: false, message: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <Button onClick={run} disabled={isPending}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        Executar coleta
      </Button>
      {feedback && (
        <p
          className={
            feedback.ok
              ? "flex items-center gap-1.5 text-xs text-emerald-400"
              : "flex items-center gap-1.5 text-xs text-red-400"
          }
          role="status"
        >
          {feedback.ok ? (
            <CircleCheck className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          )}
          {feedback.message}
        </p>
      )}
    </div>
  );
}
