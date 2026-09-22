"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { addProductCostAction, removeProductCostAction } from "@/app/dashboard/products/actions";

export interface CostRow {
  id: string;
  unitCents: number;
  freightCents: number;
  packagingCents: number;
  feesCents: number;
  otherCents: number;
  note: string | null;
  effectiveFrom: string; // ISO
}

function toCents(value: string): number {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

/**
 * Cost history + "novo custo" form. Every mutation triggers automatic margin
 * recalculation server-side (productCostService → recalculatePricing).
 */
export function ProductCostPanel({
  productId,
  costs,
  canEdit,
}: {
  productId: string;
  costs: CostRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    unit: "",
    freight: "",
    packaging: "",
    fees: "",
    other: "",
    note: "",
  });

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addProductCostAction(productId, {
        unitCents: toCents(form.unit),
        freightCents: toCents(form.freight),
        packagingCents: toCents(form.packaging),
        feesCents: toCents(form.fees),
        otherCents: toCents(form.other),
        note: form.note || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm({ unit: "", freight: "", packaging: "", fees: "", other: "", note: "" });
      setOpen(false);
      router.refresh();
    });
  }

  function remove(costId: string) {
    startTransition(async () => {
      const result = await removeProductCostAction(productId, costId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  const total = (cost: CostRow) =>
    cost.unitCents + cost.freightCents + cost.packagingCents + cost.feesCents + cost.otherCents;

  return (
    <div className="space-y-3">
      {costs.length === 0 ? (
        <p className="text-sm text-white/40">
          Nenhum custo registrado — a margem considera custo zero.
        </p>
      ) : (
        <ul className="space-y-2">
          {costs.map((cost, index) => (
            <li
              key={cost.id}
              className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-white">
                  {formatCurrency(total(cost))}
                  {index === 0 && (
                    <span className="ml-2 rounded bg-brand-600/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-300">
                      ATUAL
                    </span>
                  )}
                </p>
                <p className="text-xs text-white/40">
                  {new Date(cost.effectiveFrom).toLocaleDateString("pt-BR")}
                  {cost.note && ` · ${cost.note}`}
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(cost.id)}
                  disabled={pending}
                  aria-label="Remover custo"
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
          Novo custo
        </Button>
      )}

      {canEdit && open && (
        <div className="space-y-2 rounded-lg border border-surface-700 bg-surface-900/60 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(
              [
                ["unit", "Custo unitário (R$) *"],
                ["freight", "Frete (R$)"],
                ["packaging", "Embalagem (R$)"],
                ["fees", "Taxas (R$)"],
                ["other", "Outros (R$)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <label className="text-[11px] font-medium text-white/50">{label}</label>
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={form[key]}
                  onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
                  className="h-9"
                />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-white/50">Observação</label>
              <Input
                placeholder="Lote, fornecedor…"
                value={form.note}
                onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                className="h-9"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Registrar custo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
          <p className="text-[11px] text-white/30">
            A margem do produto é recalculada automaticamente ao salvar.
          </p>
        </div>
      )}
    </div>
  );
}
