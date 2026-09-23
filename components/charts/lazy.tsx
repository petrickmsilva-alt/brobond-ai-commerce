"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lazily-loaded chart entry points (PR010.1 §11 — Performance).
 *
 * Recharts pulls in a large dependency graph (d3-scale, d3-shape, …). Loading
 * it through `next/dynamic` with `ssr: false` keeps it out of the server
 * render and out of the initial client bundle: the dashboard's HTML, KPIs and
 * tables paint first, and each chart hydrates afterwards behind a
 * same-height skeleton so nothing shifts on screen (no CLS).
 */

function PlotSkeleton({ height }: { height: number }) {
  return <Skeleton className="w-full rounded-xl" style={{ height }} />;
}

export const LazyAreaChart = dynamic(() => import("./area-chart").then((mod) => mod.AreaChart), {
  ssr: false,
  loading: () => <PlotSkeleton height={260} />,
});

export const LazyLineChart = dynamic(() => import("./line-chart").then((mod) => mod.LineChart), {
  ssr: false,
  loading: () => <PlotSkeleton height={260} />,
});

export const LazyHorizontalBarChart = dynamic(
  () => import("./bar-chart").then((mod) => mod.HorizontalBarChart),
  { ssr: false, loading: () => <PlotSkeleton height={260} /> },
);

export const LazyDonutChart = dynamic(() => import("./donut-chart").then((mod) => mod.DonutChart), {
  ssr: false,
  loading: () => <PlotSkeleton height={260} />,
});

export const LazySparkline = dynamic(() => import("./sparkline").then((mod) => mod.Sparkline), {
  ssr: false,
  loading: () => <PlotSkeleton height={40} />,
});
