import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "neutral";
  icon: LucideIcon;
}

export function KpiCard({ label, value, delta, trend = "neutral", icon: Icon }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-white/50">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
          {delta && (
            <p
              className={cn(
                "mt-2 inline-flex items-center gap-1 text-xs font-medium",
                trend === "up" && "text-emerald-400",
                trend === "down" && "text-red-400",
                trend === "neutral" && "text-white/40",
              )}
            >
              {trend === "up" && <ArrowUpRight className="h-3.5 w-3.5" />}
              {trend === "down" && <ArrowDownRight className="h-3.5 w-3.5" />}
              {delta}
            </p>
          )}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600/15 text-brand-300">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
