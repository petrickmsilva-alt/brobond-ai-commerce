import type { ExternalContentStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  EXTERNAL_CONTENT_STATUS_LABELS,
  type ExternalContentStatusName,
} from "@/modules/connectors/core/connector.interface";

/** Import-outcome badge — Importado · Duplicado · Falha. */
const TONES: Record<ExternalContentStatusName, "brand" | "neutral" | "success" | "warning"> = {
  IMPORTED: "success",
  DUPLICATE: "brand",
  FAILED: "warning",
};

export function ContentStatusBadge({ status }: { status: ExternalContentStatus }) {
  const name = status as ExternalContentStatusName;
  return (
    <Badge tone={TONES[name] ?? "neutral"}>{EXTERNAL_CONTENT_STATUS_LABELS[name] ?? status}</Badge>
  );
}
