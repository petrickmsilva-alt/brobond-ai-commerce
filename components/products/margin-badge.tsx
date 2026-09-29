import { cn } from "@/lib/utils";
import { formatMarginBps } from "@/modules/commerce/products/pricing/margin";

/**
 * Margin pill — color-graded gross margin (basis points).
 *   < 0        red    (selling below cost)
 *   0–1999     amber  (thin margin)
 *   2000–4999  white  (healthy)
 *   ≥ 5000     green  (excellent)
 */
export function MarginBadge({ bps }: { bps: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        bps < 0 && "bg-red-500/15 text-red-300",
        bps >= 0 && bps < 2000 && "bg-amber-500/15 text-amber-300",
        bps >= 2000 && bps < 5000 && "bg-surface-700/60 text-white/80",
        bps >= 5000 && "bg-emerald-500/15 text-emerald-300",
      )}
    >
      {formatMarginBps(bps)}
    </span>
  );
}
