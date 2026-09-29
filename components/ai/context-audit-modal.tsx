"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiMessageContextActionResult } from "@/app/dashboard/ai/actions";

interface Props {
  data: AiMessageContextActionResult;
  onClose: () => void;
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-white/40">{label}</dt>
      <dd className="break-all font-mono text-xs text-white/80">{value}</dd>
    </div>
  );
}

/**
 * PR007.1 — AI Context Audit: read-only modal with the full context used to
 * generate an AI message (creator / product / campaign / trend blocks,
 * generation metadata and the persisted `contextSnapshot` JSON, pretty
 * printed and strictly read-only).
 */
export function ContextAuditModal({ data, onClose }: Props) {
  const blocks: Array<{ label: string; value: string | null }> = [
    { label: "Creator", value: data.creator },
    { label: "Produto", value: data.product },
    { label: "Campanha", value: data.campaign },
    { label: "Trend", value: data.trend },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Contexto da geração"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-surface-700 bg-surface-950 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Contexto da geração</h3>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {blocks.map((block) => (
            <div
              key={block.label}
              className="rounded-lg border border-surface-800 bg-surface-900/50 p-3"
            >
              <p className="text-xs uppercase text-white/40">{block.label}</p>
              <p className="text-sm text-white">{block.value ?? "—"}</p>
            </div>
          ))}
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-surface-800 bg-surface-900/50 p-3 sm:grid-cols-3">
          <MetaItem label="Prompt Version" value={data.promptVersion} />
          <MetaItem label="Model" value={data.model} />
          <MetaItem label="Temperature" value={String(data.temperature)} />
          <MetaItem label="Tokens" value={`${data.inputTokens} in · ${data.outputTokens} out`} />
          <div className="col-span-2">
            <MetaItem label="Context Hash" value={data.contextHash} />
          </div>
        </dl>

        <div>
          <p className="mb-1 text-xs uppercase text-white/40">Context Snapshot (somente leitura)</p>
          {data.snapshotAvailable ? (
            <pre className="max-h-72 overflow-auto rounded-lg border border-surface-800 bg-surface-900 p-3 font-mono text-xs whitespace-pre-wrap text-white/80">
              {JSON.stringify(data.snapshot, null, 2)}
            </pre>
          ) : (
            <p className="rounded-lg border border-surface-800 bg-surface-900/50 p-3 text-xs text-white/50">
              Mensagem gerada antes do PR007.1 — não há snapshot de contexto persistido para esta
              mensagem.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
