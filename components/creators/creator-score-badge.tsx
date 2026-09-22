import { Badge } from "@/components/ui/badge";

/**
 * Badge for a 0–100 creator score (PR003).
 *
 * ≥ 80  → success (premium)
 * 65–79 → brand (promissor)
 * 50–64 → warning (moderado)
 * < 50  → neutral
 */
export function CreatorScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 80 ? "success" : score >= 65 ? "brand" : score >= 50 ? "warning" : "neutral";
  return (
    <Badge tone={tone} className="tabular-nums">
      {score}
      <span className="ml-0.5 opacity-60">/100</span>
    </Badge>
  );
}
