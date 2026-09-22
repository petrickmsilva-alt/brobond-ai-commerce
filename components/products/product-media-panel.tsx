"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  addProductMediaAction,
  removeProductMediaAction,
  setPrimaryMediaAction,
} from "@/app/dashboard/products/actions";

export interface MediaRow {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
}

/**
 * Media gallery. Attaching by URL works today; binary upload is interface-
 * prepared (modules/commerce/products/services/media-storage.ts) and lands in
 * a future PR without changing this component's flow.
 */
export function ProductMediaPanel({
  productId,
  media,
  canEdit,
}: {
  productId: string;
  media: MediaRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ url: "", altText: "" });

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addProductMediaAction(productId, {
        url: form.url,
        altText: form.altText || undefined,
        isPrimary: media.length === 0,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm({ url: "", altText: "" });
      setOpen(false);
      router.refresh();
    });
  }

  function setPrimary(mediaId: string) {
    startTransition(async () => {
      const result = await setPrimaryMediaAction(productId, mediaId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function remove(mediaId: string) {
    startTransition(async () => {
      const result = await removeProductMediaAction(productId, mediaId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {media.length === 0 ? (
        <p className="text-sm text-white/40">Nenhuma mídia anexada.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {media.map((item) => (
            <div
              key={item.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-surface-700 bg-surface-800"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.url} alt={item.altText ?? ""} className="h-full w-full object-cover" />
              {item.isPrimary && (
                <span className="absolute left-1.5 top-1.5 rounded bg-brand-600/90 p-1">
                  <Star className="h-3 w-3 text-white" />
                </span>
              )}
              {canEdit && (
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                  {!item.isPrimary && (
                    <button
                      type="button"
                      onClick={() => setPrimary(item.id)}
                      disabled={pending}
                      aria-label="Definir como principal"
                      className="rounded-md bg-surface-800 p-1.5 text-white/70 hover:text-white"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    disabled={pending}
                    aria-label="Remover mídia"
                    className="rounded-md bg-surface-800 p-1.5 text-white/70 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && !open && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Anexar mídia
        </Button>
      )}

      {canEdit && open && (
        <div className="space-y-2 rounded-lg border border-surface-700 bg-surface-900/60 p-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-white/50">URL da imagem *</label>
            <Input
              placeholder="https://…"
              value={form.url}
              onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-white/50">Texto alternativo</label>
            <Input
              placeholder="Descrição da imagem"
              value={form.altText}
              onChange={(event) => setForm((prev) => ({ ...prev, altText: event.target.value }))}
              className="h-9"
            />
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending || !form.url.trim()}>
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" />
              )}
              Anexar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
          <p className="text-[11px] text-white/30">
            Upload binário chega em um PR futuro — interface de storage preparada.
          </p>
        </div>
      )}
    </div>
  );
}
