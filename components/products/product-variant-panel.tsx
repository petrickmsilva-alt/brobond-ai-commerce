"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import {
  addProductVariantAction,
  removeProductVariantAction,
} from "@/app/dashboard/products/actions";

export interface VariantRow {
  id: string;
  name: string;
  sku: string | null;
  priceCents: number | null;
  stockQuantity: number;
  isActive: boolean;
}

function toCentsOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export function ProductVariantPanel({
  productId,
  variants,
  canEdit,
}: {
  productId: string;
  variants: VariantRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", sku: "", price: "", stock: "0" });

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addProductVariantAction(productId, {
        name: form.name,
        sku: form.sku || undefined,
        priceCents: toCentsOrNull(form.price),
        stockQuantity: Number.parseInt(form.stock, 10) || 0,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm({ name: "", sku: "", price: "", stock: "0" });
      setOpen(false);
      router.refresh();
    });
  }

  function remove(variantId: string) {
    startTransition(async () => {
      const result = await removeProductVariantAction(productId, variantId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {variants.length === 0 ? (
        <p className="text-sm text-white/40">Nenhuma variação cadastrada.</p>
      ) : (
        <ul className="space-y-2">
          {variants.map((variant) => (
            <li
              key={variant.id}
              className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-white">
                  {variant.name}
                  {!variant.isActive && (
                    <span className="ml-2 text-[10px] uppercase text-white/30">inativa</span>
                  )}
                </p>
                <p className="text-xs text-white/40">
                  {variant.sku ? `${variant.sku} · ` : ""}
                  {variant.priceCents !== null
                    ? formatCurrency(variant.priceCents)
                    : "preço do produto"}
                  {` · estoque ${variant.stockQuantity}`}
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(variant.id)}
                  disabled={pending}
                  aria-label={`Remover variação ${variant.name}`}
                  className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-red-500/15 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && !open && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Nova variação
        </Button>
      )}

      {canEdit && open && (
        <div className="space-y-2 rounded-lg border border-surface-700 bg-surface-900/60 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-white/50">Nome *</label>
              <Input
                placeholder="Ex.: Tamanho M"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-white/50">SKU</label>
              <Input
                placeholder="BB-0001-M"
                value={form.sku}
                onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-white/50">
                Preço (R$) <span className="text-white/30">(vazio = herda)</span>
              </label>
              <Input
                inputMode="decimal"
                placeholder="149,90"
                value={form.price}
                onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-white/50">Estoque</label>
              <Input
                type="number"
                min={0}
                value={form.stock}
                onChange={(event) => setForm((prev) => ({ ...prev, stock: event.target.value }))}
                className="h-9"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending || !form.name.trim()}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Adicionar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
