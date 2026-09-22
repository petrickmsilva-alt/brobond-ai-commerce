import { Badge } from "@/components/ui/badge";
import type { CreatorStatusName } from "@/modules/creators/interfaces/creator.interface";
import { CREATOR_STATUS_LABELS } from "@/modules/creators/interfaces/creator.interface";

/**
 * Badge for a CRM pipeline status (PR003).
 *
 * NEW         → neutral
 * QUALIFIED   → brand
 * CONTACTED   → warning
 * NEGOTIATING → warning
 * ACTIVE      → success
 * ARCHIVED    → neutral (muted)
 */
const STATUS_TONES: Record<CreatorStatusName, "brand" | "neutral" | "success" | "warning"> = {
  NEW: "neutral",
  QUALIFIED: "brand",
  CONTACTED: "warning",
  NEGOTIATING: "warning",
  ACTIVE: "success",
  ARCHIVED: "neutral",
};

export function CreatorStatusBadge({ status }: { status: CreatorStatusName }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={status === "ARCHIVED" ? "opacity-60" : undefined}>
      {CREATOR_STATUS_LABELS[status]}
    </Badge>
  );
}
