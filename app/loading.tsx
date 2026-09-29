import { Skeleton } from "@/components/ui/skeleton";

/**
 * Landing route loading state (PR010.2 §9 — "Loading Landing").
 *
 * The landing page became async in §1 (it resolves the session to decide where
 * the Dashboard CTA points). This fallback mirrors its composition — nav, hero,
 * feature grid — so the page's silhouette is present from the first frame and
 * nothing jumps when the real content replaces it.
 */
export default function LandingLoading() {
  return (
    <div className="bg-premium-glow min-h-screen" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>

      {/* Nav */}
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-xl" />
          <Skeleton className="h-8 w-28 rounded-xl" />
        </div>
      </div>

      {/* Hero */}
      <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24">
        <Skeleton className="h-6 w-52 rounded-full" />
        <Skeleton className="mt-6 h-14 w-full max-w-2xl" />
        <Skeleton className="mt-6 h-4 w-full max-w-xl" />
        <Skeleton className="mt-2 h-4 w-3/4 max-w-lg" />
        <div className="mt-10 flex gap-3">
          <Skeleton className="h-11 w-48 rounded-xl" />
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
      </div>

      {/* Features */}
      <div className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
