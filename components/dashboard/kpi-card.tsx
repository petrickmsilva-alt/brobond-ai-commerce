import type { LucideIcon } from "lucide-react";
import { StatCard, type Trend } from "@/components/ui/stat-card";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  trend?: Trend;
  icon: LucideIcon;
}

/**
 * KpiCard — thin compatibility shim over the design-system `StatCard`.
 *
 * PR010.1 consolidated every metric tile into `components/ui/stat-card.tsx`.
 * This wrapper keeps the PR000 API alive so the existing module dashboards
 * (products, creators, analytics, connectors, TikTok, delivery, …) pick up the
 * new visual language without a single edit. New code should import `StatCard`
 * directly.
 */
export function KpiCard({ label, value, delta, trend = "neutral", icon }: KpiCardProps) {
  return <StatCard label={label} value={value} delta={delta} trend={trend} icon={icon} />;
}
