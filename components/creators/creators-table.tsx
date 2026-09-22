"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Users } from "lucide-react";
import type { CreatorListItemDTO } from "@/modules/creators/crm/dto/creator.dto";
import type { CreatorStatusName } from "@/modules/creators/interfaces/creator.interface";
import { CREATOR_SOURCE_LABELS } from "@/modules/creators/interfaces/creator.interface";
import { formatCompactNumber, cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CreatorAvatar } from "./creator-avatar";
import { CreatorScoreBadge } from "./creator-score-badge";
import { CreatorStatusBadge } from "./creator-status-badge";

/**
 * Creators table — Avatar · Creator · Nicho · Seguidores · Score · Status.
 * Sortable columns (URL-state), compact number formatting, responsive via
 * horizontal scroll on small screens.
 */
interface CreatorsTableProps {
  items: CreatorListItemDTO[];
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

  const activeSort = searchParams.get("sort") ?? "creatorScore";
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

export function CreatorsTable({ items }: CreatorsTableProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <Users className="h-10 w-10 text-white/20" />
        <p className="text-sm text-white/50">Nenhum creator encontrado.</p>
        <p className="text-xs text-white/30">
          Execute a descoberta (ADMIN) ou adicione um profile manual para começar.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-12">{/* avatar */}</TableHead>
          <SortableHead column="handle" label="Creator" />
          <SortableHead column="niche" label="Nicho" />
          <SortableHead column="followers" label="Seguidores" align="right" />
          <SortableHead column="creatorScore" label="Score" align="right" />
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((creator) => (
          <TableRow key={creator.id}>
            <TableCell>
              <CreatorAvatar displayName={creator.displayName} avatarUrl={creator.avatarUrl} />
            </TableCell>
            <TableCell>
              <p className="text-sm font-medium text-white">{creator.displayName}</p>
              <p className="truncate text-xs text-white/30">
                {creator.handle} · {CREATOR_SOURCE_LABELS[creator.source]}
              </p>
            </TableCell>
            <TableCell>
              <Badge tone="neutral">{creator.niche}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums text-white/70">
              {formatCompactNumber(creator.followers)}
            </TableCell>
            <TableCell className="text-right">
              <CreatorScoreBadge score={creator.creatorScore} />
            </TableCell>
            <TableCell>
              <CreatorStatusBadge status={creator.status as CreatorStatusName} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
