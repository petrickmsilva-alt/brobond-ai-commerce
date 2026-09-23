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

/* ------------------------------------------------------------------ */
/* PR010.2 §9 — route-level loading states                             */
/* ------------------------------------------------------------------ */

/**
 * Skeleton shaped like a `PageHeader` — eyebrow, title, description, actions.
 * Every route-level fallback starts with this so the page's identity appears
 * instantly and only the data area shimmers.
 */
export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28 rounded-xl" />
        <Skeleton className="h-9 w-24 rounded-xl" />
      </div>
    </div>
  );
}

/**
 * Full-page dashboard skeleton (§9 — "Skeleton Dashboard").
 *
 * Mirrors the real `/dashboard` composition — header, 6 KPIs, chart row,
 * quick actions + activity — so the layout does not jump when the data
 * arrives. `aria-busy` + a polite live region announce the wait once, instead
 * of the screen reader enumerating a dozen empty boxes.
 */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o dashboard…</span>

      <PageHeaderSkeleton />

      {/* KPI row — 6 cards, matching the live grid breakpoints. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>

      {/* Chart row. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartSkeleton height={280} />
        </div>
        <ChartSkeleton height={280} />
      </div>

      {/* Quick actions + activity. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/8 bg-surface-850 p-6 lg:col-span-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-2 h-3 w-64 max-w-full" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-surface-850 p-6">
          <Skeleton className="h-4 w-28" />
          <div className="mt-5 space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for a list/table page (Produtos, Creators, Campanhas…).
 * Header + KPI strip + toolbar + table, in the proportions those pages use.
 */
export function ListPageSkeleton({ kpis = 4, rows = 8 }: { kpis?: number; rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>

      <PageHeaderSkeleton />

      {kpis > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: kpis }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-white/8 bg-surface-850 p-6">
        <div className="mb-5 flex flex-wrap gap-2">
          <Skeleton className="h-10 w-64 max-w-full rounded-xl" />
          <Skeleton className="h-10 w-36 rounded-xl" />
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
        <TableSkeleton rows={rows} />
      </div>
    </div>
  );
}

/**
 * Centred card skeleton for the auth screens (§9 — "Loading Login").
 * Reproduces the glass card's geometry so the shell does not shift when the
 * real form mounts.
 */
export function AuthCardSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="glass-panel glass-edge relative overflow-hidden rounded-2xl p-7 sm:p-8"
    >
      <span className="sr-only">Carregando…</span>

      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-2.5 h-3.5 w-60 max-w-full" />

      <div className="mt-7 space-y-5">
        {Array.from({ length: fields }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        ))}
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}
