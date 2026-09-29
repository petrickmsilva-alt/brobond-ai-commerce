"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { CreatorPipelineColumnDTO } from "@/modules/creators/crm/dto/creator.dto";
import {
  CREATOR_STATUSES,
  canTransitionCreatorStatus,
  type CreatorStatusName,
} from "@/modules/creators/interfaces/creator.interface";
import { formatCompactNumber, cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { CreatorAvatar } from "./creator-avatar";
import { CreatorScoreBadge } from "./creator-score-badge";
import { changeCreatorStatusAction } from "@/app/dashboard/creators/actions";

/**
 * CRM pipeline Kanban (PR003) — one column per `CreatorStatus`, in funnel
 * order: NEW → QUALIFIED → CONTACTED → NEGOTIATING → ACTIVE (+ ARCHIVED).
 *
 * MANAGER+ (and ADMIN) may move a card one step at a time (or archive /
 * reactivate); MEMBER sees a read-only board. Every move goes through
 * `changeCreatorStatusAction`, which re-asserts the session, the tenant
 * and the transition map server-side.
 */
interface CreatorsKanbanProps {
  columns: CreatorPipelineColumnDTO[];
  canManage: boolean;
}

/** Tone per column header — mirrors the status badge palette. */
const COLUMN_ACCENTS: Record<CreatorStatusName, string> = {
  NEW: "border-t-white/30",
  QUALIFIED: "border-t-brand-500/60",
  CONTACTED: "border-t-amber-500/60",
  NEGOTIATING: "border-t-amber-400/80",
  ACTIVE: "border-t-emerald-500/60",
  ARCHIVED: "border-t-white/15",
};

function adjacent(status: CreatorStatusName, direction: 1 | -1): CreatorStatusName | null {
  const index = CREATOR_STATUSES.indexOf(status);
  const next = CREATOR_STATUSES[index + direction];
  return next ?? null;
}

function CreatorCard({
  creator,
  canManage,
  onMove,
  busy,
}: {
  creator: CreatorPipelineColumnDTO["items"][number];
  canManage: boolean;
  onMove: (id: string, status: CreatorStatusName) => void;
  busy: boolean;
}) {
  const from = creator.status as CreatorStatusName;
  const prev = adjacent(from, -1);
  const next = adjacent(from, 1);
  const canPrev = prev !== null && canTransitionCreatorStatus(from, prev);
  const canNext = next !== null && canTransitionCreatorStatus(from, next);
  const isArchived = from === "ARCHIVED";

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900/80 p-3 transition-colors hover:border-surface-600">
      <div className="flex items-start gap-2.5">
        <CreatorAvatar
          displayName={creator.displayName}
          avatarUrl={creator.avatarUrl}
          className="h-8 w-8"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{creator.displayName}</p>
          <p className="truncate text-xs text-white/30">{creator.handle}</p>
        </div>
        <CreatorScoreBadge score={creator.creatorScore} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-white/40">
        <span>{creator.niche}</span>
        <span className="tabular-nums">{formatCompactNumber(creator.followers)} seg.</span>
      </div>
      {canManage && (canPrev || canNext) && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-surface-700/70 pt-2">
          {canPrev && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onMove(creator.id, prev!)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-white/50 transition-colors hover:bg-surface-700 hover:text-white disabled:opacity-40"
              aria-label={`Mover ${creator.handle} para trás`}
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
          )}
          <span className="flex-1" />
          {isArchived ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onMove(creator.id, "NEW")}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-white/50 transition-colors hover:bg-surface-700 hover:text-white disabled:opacity-40"
            >
              <ArchiveRestore className="h-3 w-3" />
              Reativar
            </button>
          ) : (
            canNext && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onMove(creator.id, next!)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-white/50 transition-colors hover:bg-surface-700 hover:text-white disabled:opacity-40"
                aria-label={`Mover ${creator.handle} para frente`}
              >
                Avançar
                <ChevronRight className="h-3 w-3" />
              </button>
            )
          )}
          {!isArchived && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onMove(creator.id, "ARCHIVED")}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-white/40 transition-colors hover:bg-surface-700 hover:text-white disabled:opacity-40"
              aria-label={`Arquivar ${creator.handle}`}
            >
              <Archive className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function CreatorsKanban({ columns, canManage }: CreatorsKanbanProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(id: string, status: CreatorStatusName) {
    setError(null);
    startTransition(async () => {
      const result = await changeCreatorStatusAction({ id, status });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/60">Pipeline</h2>
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-3 grid grid-flow-col auto-cols-[minmax(220px,1fr)] gap-3 overflow-x-auto pb-2">
        {columns.map((column) => (
          <Card
            key={column.status}
            className={cn("border-t-2", COLUMN_ACCENTS[column.status], "min-w-[220px]")}
          >
            <div className="flex items-center justify-between px-3 pb-2 pt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                {column.label}
              </span>
              <span className="rounded-full bg-surface-700/60 px-2 py-0.5 text-[11px] tabular-nums text-white/60">
                {column.count}
              </span>
            </div>
            <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto px-3 pb-3">
              {column.items.length === 0 && (
                <p className="rounded-lg border border-dashed border-surface-700 px-3 py-6 text-center text-xs text-white/30">
                  Vazio
                </p>
              )}
              {column.items.map((creator) => (
                <CreatorCard
                  key={creator.id}
                  creator={creator}
                  canManage={canManage}
                  onMove={move}
                  busy={isPending}
                />
              ))}
              {column.count > column.items.length && (
                <p className="pt-1 text-center text-[11px] text-white/30">
                  +{column.count - column.items.length} na coluna
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
