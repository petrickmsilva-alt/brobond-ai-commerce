"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, TrendingUp } from "lucide-react";
import type { TrendSnapshotItemDTO } from "@/modules/trends/dto/create-trend.dto";
import { keywordSlug } from "@/modules/trends/validators/trend.validator";
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
import { TrendScoreBadge } from "./trend-score-badge";

/**
 * Trends table — Keyword · Categoria · Views · Likes · Score.
 * Sortable columns (URL-state), compact number formatting, responsive via
 * horizontal scroll on small screens.
 */
interface TrendsTableProps {
  items: TrendSnapshotItemDTO[];
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

  const activeSort = searchParams.get("sort") ?? "trendScore";
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

export function TrendsTable({ items }: TrendsTableProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <TrendingUp className="h-10 w-10 text-white/20" />
        <p className="text-sm text-white/50">Nenhuma tendência encontrada.</p>
        <p className="text-xs text-white/30">
          Execute a coleta diária (ADMIN) ou ajuste os filtros para começar.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <SortableHead column="keyword" label="Keyword" />
          <SortableHead column="category" label="Categoria" />
          <SortableHead column="views" label="Views" align="right" />
          <SortableHead column="likes" label="Likes" align="right" />
          <SortableHead column="trendScore" label="Score" align="right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((trend) => (
          <TableRow key={trend.id}>
            <TableCell>
              <p className="text-sm font-medium text-white">{trend.keyword}</p>
              <p className="truncate text-xs text-white/30">/{keywordSlug(trend.keyword)}</p>
            </TableCell>
            <TableCell>
              <Badge tone="neutral">{trend.category}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums text-white/70">
              {formatCompactNumber(trend.views)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-white/70">
              {formatCompactNumber(trend.likes)}
            </TableCell>
            <TableCell className="text-right">
              <TrendScoreBadge score={trend.trendScore} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
