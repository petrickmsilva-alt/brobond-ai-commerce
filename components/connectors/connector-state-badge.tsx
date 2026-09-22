import type { ConnectorState } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  CONNECTOR_STATE_LABELS,
  type ConnectorStateName,
} from "@/modules/connectors/core/connector.interface";

/**
 * Connector state badge — IDLE · ACTIVE · ERROR · DISABLED, with the same
 * tone vocabulary the rest of the dashboard uses.
 */
const TONES: Record<ConnectorStateName, "brand" | "neutral" | "success" | "warning"> = {
  IDLE: "neutral",
  ACTIVE: "success",
  ERROR: "warning",
  DISABLED: "neutral",
};

export function ConnectorStateBadge({ state }: { state: ConnectorState }) {
  const name = state as ConnectorStateName;
  return <Badge tone={TONES[name] ?? "neutral"}>{CONNECTOR_STATE_LABELS[name] ?? state}</Badge>;
}
