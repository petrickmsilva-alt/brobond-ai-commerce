"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TREND_CATEGORIES } from "@/modules/trends/interfaces/trend.interface";
import { createTrendSnapshotAction } from "@/app/dashboard/trends/actions";

/**
 * Manual snapshot creation (ADMIN only — the action re-asserts
 * `requireAdmin()`). Collapsed by default; the score is computed
 * server-side by the score engine, never sent from the client.
 */
export function CreateTrendForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [success, setSuccess] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSuccess(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      keyword: String(data.get("keyword") ?? ""),
      category: String(data.get("category") ?? ""),
      views: Number(data.get("views") ?? 0),
      likes: Number(data.get("likes") ?? 0),
      shares: Number(data.get("shares") ?? 0),
      margin: Number(data.get("margin") ?? 0),
      saturation: Number(data.get("saturation") ?? 0),
    };

    startTransition(async () => {
      const result = await createTrendSnapshotAction(input);
      if (result.ok) {
        setSuccess(`"${input.keyword}" salva com score ${result.data.trendScore}/100.`);
        formRef.current?.reset();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  function fieldError(name: string): string | undefined {
    return fieldErrors[name]?.[0];
  }

  const numberInputClass = "w-full";

  return (
    <details className="group mb-4 rounded-xl border border-surface-700 bg-surface-800/40">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium text-white/70 transition-colors hover:text-white">
        <Plus className="h-4 w-4 text-brand-400" />
        Nova tendência (snapshot manual)
        <ChevronDown className="ml-auto h-4 w-4 text-white/30 transition-transform group-open:rotate-180" />
      </summary>

      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-4 border-t border-surface-700 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="sm:col-span-2">
          <label htmlFor="trend-keyword" className="mb-1 block text-xs text-white/50">
            Keyword
          </label>
          <Input id="trend-keyword" name="keyword" placeholder="ex.: camisa masculina" required />
          {fieldError("keyword") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("keyword")}</p>
          )}
        </div>

        <div>
          <label htmlFor="trend-category" className="mb-1 block text-xs text-white/50">
            Categoria
          </label>
          <Select id="trend-category" name="category" defaultValue="Moda" required>
            {TREND_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
          {fieldError("category") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("category")}</p>
          )}
        </div>

        <div>
          <label htmlFor="trend-views" className="mb-1 block text-xs text-white/50">
            Views
          </label>
          <Input
            id="trend-views"
            name="views"
            type="number"
            min={0}
            step={1}
            defaultValue={0}
            className={numberInputClass}
          />
          {fieldError("views") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("views")}</p>
          )}
        </div>

        <div>
          <label htmlFor="trend-likes" className="mb-1 block text-xs text-white/50">
            Likes
          </label>
          <Input
            id="trend-likes"
            name="likes"
            type="number"
            min={0}
            step={1}
            defaultValue={0}
            className={numberInputClass}
          />
        </div>

        <div>
          <label htmlFor="trend-shares" className="mb-1 block text-xs text-white/50">
            Shares
          </label>
          <Input
            id="trend-shares"
            name="shares"
            type="number"
            min={0}
            step={1}
            defaultValue={0}
            className={numberInputClass}
          />
        </div>

        <div>
          <label htmlFor="trend-margin" className="mb-1 block text-xs text-white/50">
            Margem (0–100%)
          </label>
          <Input
            id="trend-margin"
            name="margin"
            type="number"
            min={0}
            max={100}
            step={1}
            defaultValue={50}
            className={numberInputClass}
          />
          {fieldError("margin") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("margin")}</p>
          )}
        </div>

        <div>
          <label htmlFor="trend-saturation" className="mb-1 block text-xs text-white/50">
            Saturação (0–100%)
          </label>
          <Input
            id="trend-saturation"
            name="saturation"
            type="number"
            min={0}
            max={100}
            step={1}
            defaultValue={20}
            className={numberInputClass}
          />
          {fieldError("saturation") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("saturation")}</p>
          )}
        </div>

        <div className="flex items-end justify-end sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Criar snapshot
          </Button>
        </div>

        {error && <p className="text-sm text-red-400 sm:col-span-2 lg:col-span-4">{error}</p>}
        {success && (
          <p className="text-sm text-emerald-400 sm:col-span-2 lg:col-span-4" role="status">
            {success}
          </p>
        )}
      </form>
    </details>
  );
}
