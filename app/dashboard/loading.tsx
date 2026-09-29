import { DashboardSkeleton } from "@/components/ui/skeleton";

/**
 * Dashboard route loading state (PR010.2 §9 — "Skeleton Dashboard").
 *
 * `/dashboard` awaits the analytics read model plus several tenant-scoped
 * counters before it can render a single number. Without this file the user
 * stares at the previous page (or nothing) for the whole round trip; with it,
 * the shell paints instantly and only the data regions shimmer.
 *
 * A skeleton rather than a spinner, deliberately: it communicates the shape of
 * what is coming, which makes the wait feel shorter and prevents the layout
 * shift a centred spinner always causes when the real content lands.
 */
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
