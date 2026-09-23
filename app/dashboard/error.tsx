"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * Dashboard error boundary (PR010.2 §8) — "remover erro branco".
 *
 * Next.js renders this whenever a Server Component, a data fetch or a client
 * render throws anywhere under `/dashboard`. Before PR010.2 there was no
 * boundary here, so the framework fell back to an unstyled white page showing
 * only a digest hash — no navigation, no retry, no way to report it.
 *
 * `reset()` re-renders the failed segment without a full page reload, which
 * recovers transient failures (a dropped database connection, a timed-out
 * upstream) in place and keeps the user's scroll position and shell.
 *
 * The digest is logged to the browser console so it is visible in session
 * replay / error tooling, and shown in the UI so a user can quote it in a
 * support ticket. See `components/ui/error-state.tsx` for why the raw message
 * is never rendered in production.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard.error]", error.digest ?? error.message);
  }, [error]);

  return <ErrorState error={error} reset={reset} />;
}
