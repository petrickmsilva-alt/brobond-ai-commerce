"use client";

import * as React from "react";
import { BarChart3, LineChart as LineChartIcon, PieChart, TrendingUp } from "lucide-react";
import {
  LazyAreaChart,
  LazyDonutChart,
  LazyHorizontalBarChart,
  LazyLineChart,
} from "@/components/charts/lazy";
import {
  formatCentsBRL,
  formatCentsCompact,
  formatCompact,
} from "@/components/charts/chart-primitives";
import { ChartCard } from "@/components/ui/chart-card";
import { EmptyState } from "@/components/ui/empty-state";
import { chartTheme } from "@/components/ui/design-system/theme";
import type { DailyPoint, FunnelSlice } from "@/lib/dashboard-overview";
import type { AttributionRow } from "@/modules/analytics/metrics/attribution";

/**
 * DashboardCharts (PR010.1) — the four visualisations of the overview page.
 *
 * Client Component purely so Recharts (a browser-only library) can mount; all
 * numbers arrive already computed from the server. Every chart is loaded
 * through `components/charts/lazy` so the Recharts bundle is fetched after the
 * page's HTML, KPIs and tables have painted.
 *
 * Series data is memoised: a parent re-render (e.g. a sidebar collapse) must
 * never force Recharts to rebuild its scales.
 */

interface DashboardChartsProps {
  daily: readonly DailyPoint[];
  topProducts: readonly AttributionRow[];
  topCreators: readonly AttributionRow[];
  creatorFunnel: readonly FunnelSlice[];
  periodDays: number;
}

export const DashboardCharts = React.memo(function DashboardCharts({
  daily,
  topProducts,
  topCreators,
  creatorFunnel,
  periodDays,
}: DashboardChartsProps) {
  const hasRevenue = React.useMemo(
    () => daily.some((point) => point.gmvCents > 0 || point.orders > 0),
    [daily],
  );

  const gmvSeries = React.useMemo(() => [...daily], [daily]);

  const ordersSeries = React.useMemo(
    () => daily.map((point) => ({ date: point.date, orders: point.orders })),
    [daily],
  );

  const productBars = React.useMemo(
    () => topProducts.map((row) => ({ label: row.label, value: row.revenueCents })),
    [topProducts],
  );

  const creatorBars = React.useMemo(
    () => topCreators.map((row) => ({ label: row.label, value: row.revenueCents })),
    [topCreators],
  );

  const funnelData = React.useMemo(() => [...creatorFunnel], [creatorFunnel]);

  const funnelTotal = React.useMemo(
    () => creatorFunnel.reduce((sum, slice) => sum + slice.value, 0),
    [creatorFunnel],
  );

  const funnelLegend = React.useMemo(
    () =>
      creatorFunnel.map((slice, index) => ({
        label: `${slice.label} (${slice.value})`,
        color: chartTheme.series[index % chartTheme.series.length] ?? chartTheme.series[0],
      })),
    [creatorFunnel],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* GMV over time — area */}
      <ChartCard
        className="lg:col-span-2"
        title="GMV no período"
        description={`Receita paga por dia nos últimos ${periodDays} dias.`}
        icon={TrendingUp}
        legend={[{ label: "GMV", color: chartTheme.series[0] ?? "#818cf8" }]}
        summary={`Gráfico de área com a receita paga diária dos últimos ${periodDays} dias.`}
      >
        {hasRevenue ? (
          <LazyAreaChart
            data={gmvSeries}
            xKey="date"
            series={[{ dataKey: "gmvCents", name: "GMV" }]}
            valueFormatter={formatCentsBRL}
            axisFormatter={formatCentsCompact}
          />
        ) : (
          <EmptyState
            size="md"
            bordered={false}
            icon={TrendingUp}
            title="Sem vendas no período"
            description="Assim que a primeira venda paga for registrada, a curva de GMV aparece aqui."
          />
        )}
      </ChartCard>

      {/* Creator pipeline — donut */}
      <ChartCard
        title="Pipeline de creators"
        description="Distribuição do CRM por estágio."
        icon={PieChart}
        legend={funnelLegend}
        summary="Gráfico de rosca com a distribuição de creators por estágio do pipeline."
      >
        {funnelTotal > 0 ? (
          <LazyDonutChart
            data={funnelData}
            valueFormatter={(value) => `${value.toLocaleString("pt-BR")} creators`}
            centerValue={funnelTotal.toLocaleString("pt-BR")}
            centerLabel="Creators"
          />
        ) : (
          <EmptyState
            size="md"
            bordered={false}
            icon={PieChart}
            title="Pipeline vazio"
            description="Execute uma descoberta de creators para popular o CRM."
          />
        )}
      </ChartCard>

      {/* Orders over time — line */}
      <ChartCard
        className="lg:col-span-2"
        title="Pedidos por dia"
        description="Volume de pedidos pagos, dia a dia."
        icon={LineChartIcon}
        legend={[{ label: "Pedidos", color: chartTheme.series[1] ?? "#22d3ee" }]}
        summary={`Gráfico de linha com o número de pedidos pagos por dia nos últimos ${periodDays} dias.`}
      >
        {hasRevenue ? (
          <LazyLineChart
            data={ordersSeries}
            xKey="date"
            series={[{ dataKey: "orders", name: "Pedidos", color: chartTheme.series[1] }]}
            valueFormatter={(value) => value.toLocaleString("pt-BR")}
            axisFormatter={formatCompact}
          />
        ) : (
          <EmptyState
            size="md"
            bordered={false}
            icon={LineChartIcon}
            title="Sem pedidos no período"
            description="O volume diário de pedidos pagos será plotado aqui."
          />
        )}
      </ChartCard>

      {/* Revenue ranking — horizontal bar */}
      <ChartCard
        title="Receita por produto"
        description="Top contribuintes do período."
        icon={BarChart3}
        summary="Gráfico de barras horizontais com a receita atribuída a cada produto."
      >
        {productBars.length > 0 ? (
          <LazyHorizontalBarChart
            data={productBars}
            name="Receita"
            valueFormatter={formatCentsBRL}
            axisFormatter={formatCentsCompact}
            labelWidth={120}
          />
        ) : (
          <EmptyState
            size="md"
            bordered={false}
            icon={BarChart3}
            title="Sem atribuição"
            description="A receita atribuída por produto aparece após a primeira venda paga."
          />
        )}
      </ChartCard>

      {/* Creator ranking — horizontal bar */}
      <ChartCard
        className="lg:col-span-3"
        title="Receita por creator"
        description="Quem está gerando receita atribuída no período."
        icon={BarChart3}
        height={220}
        summary="Gráfico de barras horizontais com a receita atribuída a cada creator."
      >
        {creatorBars.length > 0 ? (
          <LazyHorizontalBarChart
            data={creatorBars}
            name="Receita"
            height={220}
            valueFormatter={formatCentsBRL}
            axisFormatter={formatCentsCompact}
            labelWidth={160}
          />
        ) : (
          <EmptyState
            size="sm"
            bordered={false}
            icon={BarChart3}
            title="Sem receita atribuída a creators"
            description="Vincule vendas a creators para acompanhar a performance individual."
          />
        )}
      </ChartCard>
    </div>
  );
});
