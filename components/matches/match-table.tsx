"use client";

import { useState, useTransition } from "react";
import { CircleAlert, CircleCheck, Inbox, Link2, Loader2, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { approveMatch, removeMatch } from "@/app/dashboard/matches/actions";
import type { ProductMatchItemDTO } from "@/modules/campaigns/dto/product-match.dto";
import {
  MATCH_SOURCE_LABELS,
  MATCH_STATUS_LABELS,
  type MatchSourceName,
  type MatchStatusName,
} from "@/modules/campaigns/matching/match-source";
import { cn } from "@/lib/utils";

/**
 * Matches table — Vídeo · Produto · Confidence · Origem · Status (+ the
 * ADMIN/MANAGER affordances Aprovar/Remover). Rows arrive pre-sorted by
 * confidence (desc) from the server; every action re-asserts
 * `requireManager()` server-side — these buttons are affordances only.
 */

interface MatchTableProps {
  items: ProductMatchItemDTO[];
  /** ADMIN and MANAGER may write; MEMBER is read-only. */
  canManage: boolean;
}

function confidenceTone(confidence: number): "success" | "brand" | "warning" {
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.6) return "brand";
  return "warning";
}

function sourceTone(matchedBy: MatchSourceName): "brand" | "success" | "neutral" {
  switch (matchedBy) {
    case "AI":
      return "brand";
    case "MANUAL":
      return "success";
    default:
      return "neutral";
  }
}

export function MatchTable({ items, canManage }: MatchTableProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  function approve(matchId: string) {
    setFeedback(null);
    startTransition(async () => {
      const result = await approveMatch({ matchId });
      setFeedback(
        result.ok
          ? { ok: true, message: "Match aprovado (origem Manual, confiança 1.00)." }
          : { ok: false, message: result.error },
      );
    });
  }

  function remove(matchId: string) {
    setFeedback(null);
    startTransition(async () => {
      const result = await removeMatch({ matchId });
      setFeedback(
        result.ok ? { ok: true, message: "Match removido." } : { ok: false, message: result.error },
      );
    });
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <Inbox className="h-10 w-10 text-white/20" />
        <p className="text-sm text-white/50">Nenhum match encontrado.</p>
        <p className="text-xs text-white/30">
          Execute o matcher sobre o conteúdo importado ou ajuste a busca para começar.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Vídeo</TableHead>
            <TableHead>Produto</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead>Status</TableHead>
            {canManage && <TableHead className="text-right">Ações</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((match) => (
            <TableRow key={match.id}>
              <TableCell>
                <p className="max-w-xs truncate text-sm font-medium text-white">
                  {match.content.title}
                </p>
                <p className="truncate text-xs text-white/30">
                  {match.content.externalId} · {match.content.platform}
                  {match.content.url ? (
                    <a
                      href={match.content.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 text-brand-300/80 underline-offset-2 hover:underline"
                    >
                      abrir
                    </a>
                  ) : null}
                </p>
              </TableCell>
              <TableCell>
                <p className="text-sm text-white">{match.product.name}</p>
                <p className="text-xs text-white/30">{match.product.slug}</p>
              </TableCell>
              <TableCell className="text-right">
                <Badge tone={confidenceTone(match.confidence)}>{match.confidence.toFixed(2)}</Badge>
              </TableCell>
              <TableCell>
                <Badge tone={sourceTone(match.matchedBy)}>
                  {MATCH_SOURCE_LABELS[match.matchedBy]}
                </Badge>
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-medium",
                    match.status === "APROVADO" ? "text-emerald-400" : "text-amber-300",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      match.status === "APROVADO" ? "bg-emerald-400" : "bg-amber-300",
                    )}
                  />
                  {MATCH_STATUS_LABELS[match.status as MatchStatusName]}
                </span>
              </TableCell>
              {canManage && (
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {match.status === "PENDENTE" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => approve(match.id)}
                      >
                        {isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CircleCheck className="h-3.5 w-3.5" />
                        )}
                        Aprovar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => remove(match.id)}
                      aria-label="Remover match"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {feedback && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 border-t border-surface-700 px-4 py-3 text-xs",
            feedback.ok ? "text-emerald-400" : "text-red-400",
          )}
        >
          {feedback.ok ? (
            <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          {feedback.message}
        </p>
      )}

      {!canManage && (
        <p className="flex items-center gap-1.5 border-t border-surface-700 px-4 py-3 text-xs text-white/30">
          <Link2 className="h-3.5 w-3.5" />
          Somente leitura — criar, aprovar e remover matches exige MANAGER ou ADMIN.
        </p>
      )}
    </div>
  );
}
