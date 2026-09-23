import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Skeleton (PR010.1) — loading placeholder with a shimmer sweep.
 *
 * Always `aria-hidden`: assistive tech should hear the surrounding live
 * region / `aria-busy` container, not a stack of empty boxes.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton-shimmer rounded-lg", className)} {...props} />;
}

/** Skeleton shaped like a `StatCard` — used as the KPI grid fallback. */
export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/8 bg-surface-850 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>
    </div>
  );
}

/** Skeleton shaped like a `ChartCard` — the Suspense fallback for charts. */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-surface-850 p-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="mt-6 w-full rounded-xl" style={{ height }} />
    </div>
  );
}

/** Skeleton shaped like a data table. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      <Skeleton className="h-11 w-full" />
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}
