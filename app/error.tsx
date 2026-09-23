"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * Root error boundary (PR010.2 §8).
 *
 * Catches anything thrown outside `/dashboard` — the landing page, the auth
 * screens, `/settings`. Same elegant surface, but "Voltar" points at the home
 * page: a visitor who hit an error on `/login` has no dashboard to return to,
 * and bouncing them into a protected route would just send them back to
 * `/login` through the middleware.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app.error]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="bg-app-mesh min-h-screen">
      <ErrorState error={error} reset={reset} homeHref="/" homeLabel="Voltar para a home" />
    </div>
  );
}
