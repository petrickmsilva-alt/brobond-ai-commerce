import { ProductStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const statusConfig: Record<
  ProductStatus,
  { label: string; tone: "brand" | "neutral" | "success" | "warning" }
> = {
  [ProductStatus.DRAFT]: { label: "Rascunho", tone: "neutral" },
  [ProductStatus.ACTIVE]: { label: "Ativo", tone: "success" },
  [ProductStatus.ARCHIVED]: { label: "Arquivado", tone: "warning" },
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const config = statusConfig[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}
