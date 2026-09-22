import { Badge } from "@/components/ui/badge";

/**
 * Badge for a 0–100 trend score.
 *
 * ≥ 85 → success (alta prioridade)
 * 70–84 → brand (promissor)
 * 60–69 → warning (moderado)
 * < 60  → neutral
 */
export function TrendScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 85 ? "success" : score >= 70 ? "brand" : score >= 60 ? "warning" : "neutral";
  return (
    <Badge tone={tone} className="tabular-nums">
      {score}
      <span className="ml-0.5 opacity-60">/100</span>
    </Badge>
  );
}
