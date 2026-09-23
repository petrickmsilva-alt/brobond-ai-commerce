"use client";

import Link from "next/link";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCompactNumber, cn } from "@/lib/utils";
import type { ExternalContentItemDTO } from "@/modules/connectors/core/connector.dto";
import {
  CONNECTOR_PLATFORM_LABELS,
  EXTERNAL_CONTENT_TYPE_LABELS,
  type ConnectorPlatformName,
  type ExternalContentTypeName,
} from "@/modules/connectors/core/connector.interface";
import { Button } from "@/components/ui/button";
import { TableEmptyState } from "@/components/ui/table-empty-state";
import { ContentStatusBadge } from "./content-status-badge";

/**
 * External-content table — Conteúdo · Plataforma · Tipo · Views · Likes ·
 * Status. Sortable columns (URL-state), compact number formatting,
 * responsive via horizontal scroll on small screens.
 */
interface ContentTableProps {
  items: ExternalContentItemDTO[];
}

function SortableHead({
  column,
  label,
  align = "left",
}: {
  column: string;
  label: string;
  align?: "left" | "right";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeSort = searchParams.get("sort") ?? "createdAt";
  const activeOrder = searchParams.get("order") ?? "desc";
  const isActive = activeSort === column;

  function toggle() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", column);
    params.set("order", isActive && activeOrder === "desc" ? "asc" : "desc");
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-white/70",
          align === "right" && "flex-row-reverse",
          isActive ? "text-white/80" : "text-white/40",
        )}
      >
        {label}
        {isActive ? (
          activeOrder === "desc" ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

export function ContentTable({ items }: ContentTableProps) {
  if (items.length === 0) {
    // §10 — nothing imported yet means "go connect a source", not "sorry".
    return (
      <TableEmptyState
        icon={Inbox}
        title="Nenhum conteúdo importado"
        description="Conecte uma plataforma e execute uma sincronização para importar vídeos, posts e produtos externos."
        action={
          <>
            <Link href="/dashboard/tiktok">
              <Button size="sm">Sincronizar TikTok</Button>
            </Link>
            <Link href="/dashboard/connectors">
              <Button size="sm" variant="outline">
                Ver conectores
              </Button>
            </Link>
          </>
        }
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <SortableHead column="title" label="Conteúdo" />
          <TableHead>Plataforma</TableHead>
          <TableHead>Tipo</TableHead>
          <SortableHead column="views" label="Views" align="right" />
          <SortableHead column="likes" label="Likes" align="right" />
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((content) => (
          <TableRow key={content.id}>
            <TableCell>
              <p className="text-sm font-medium text-white">{content.title}</p>
              <p className="truncate text-xs text-white/30">
                {content.externalId}
                {content.authorHandle ? ` · ${content.authorHandle}` : ""}
              </p>
              {content.errorReason && (
                <p className="mt-0.5 line-clamp-1 text-xs text-amber-300/70">
                  {content.errorReason}
                </p>
              )}
            </TableCell>
            <TableCell>
              <Badge tone="neutral">
                {CONNECTOR_PLATFORM_LABELS[content.platform as ConnectorPlatformName] ??
                  content.platform}
              </Badge>
            </TableCell>
            <TableCell className="text-xs text-white/60">
              {EXTERNAL_CONTENT_TYPE_LABELS[content.type as ExternalContentTypeName] ??
                content.type}
            </TableCell>
            <TableCell className="text-right tabular-nums text-white/70">
              {formatCompactNumber(content.views)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-white/70">
              {formatCompactNumber(content.likes)}
            </TableCell>
            <TableCell className="text-right">
              <ContentStatusBadge status={content.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
