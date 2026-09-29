"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CREATOR_NICHES } from "@/modules/creators/interfaces/creator.interface";
import { createCreatorAction } from "@/app/dashboard/creators/actions";

/**
 * Manual creator creation (MANAGER+ — the action re-asserts
 * `requireManager()`). Collapsed by default; the score is computed
 * server-side by the score engine, never sent from the client. The
 * profile lands in the CRM as `source: MANUAL`, `status: NEW`.
 */
export function CreateCreatorForm() {
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
      handle: String(data.get("handle") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
      niche: String(data.get("niche") ?? ""),
      followers: Number(data.get("followers") ?? 0),
      avgViews: Number(data.get("avgViews") ?? 0),
      engagementRate: Number(data.get("engagementRate") ?? 0),
      tags: String(data.get("tags") ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    };

    startTransition(async () => {
      const result = await createCreatorAction(input);
      if (result.ok) {
        setSuccess(
          `"${result.data.handle}" adicionado ao CRM (score ${result.data.creatorScore}/100).`,
        );
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

  return (
    <details className="group mb-4 rounded-xl border border-surface-700 bg-surface-800/40">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium text-white/70 transition-colors hover:text-white">
        <Plus className="h-4 w-4 text-brand-400" />
        Novo creator (cadastro manual)
        <ChevronDown className="ml-auto h-4 w-4 text-white/30 transition-transform group-open:rotate-180" />
      </summary>

      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-4 border-t border-surface-700 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <label htmlFor="creator-handle" className="mb-1 block text-xs text-white/50">
            Handle
          </label>
          <Input id="creator-handle" name="handle" placeholder="ex.: @ana.souza" required />
          {fieldError("handle") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("handle")}</p>
          )}
        </div>

        <div>
          <label htmlFor="creator-name" className="mb-1 block text-xs text-white/50">
            Nome
          </label>
          <Input id="creator-name" name="displayName" placeholder="ex.: Ana Souza" required />
          {fieldError("displayName") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("displayName")}</p>
          )}
        </div>

        <div>
          <label htmlFor="creator-niche" className="mb-1 block text-xs text-white/50">
            Nicho
          </label>
          <Select id="creator-niche" name="niche" defaultValue="Moda" required>
            {CREATOR_NICHES.map((niche) => (
              <option key={niche} value={niche}>
                {niche}
              </option>
            ))}
          </Select>
          {fieldError("niche") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("niche")}</p>
          )}
        </div>

        <div>
          <label htmlFor="creator-tags" className="mb-1 block text-xs text-white/50">
            Tags (separadas por vírgula)
          </label>
          <Input id="creator-tags" name="tags" placeholder="ex.: moda masculina, premium" />
          {fieldError("tags") && <p className="mt-1 text-xs text-red-400">{fieldError("tags")}</p>}
        </div>

        <div>
          <label htmlFor="creator-followers" className="mb-1 block text-xs text-white/50">
            Seguidores
          </label>
          <Input
            id="creator-followers"
            name="followers"
            type="number"
            min={0}
            step={1}
            defaultValue={0}
          />
          {fieldError("followers") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("followers")}</p>
          )}
        </div>

        <div>
          <label htmlFor="creator-views" className="mb-1 block text-xs text-white/50">
            Views médias
          </label>
          <Input
            id="creator-views"
            name="avgViews"
            type="number"
            min={0}
            step={1}
            defaultValue={0}
          />
        </div>

        <div>
          <label htmlFor="creator-engagement" className="mb-1 block text-xs text-white/50">
            Engajamento (%)
          </label>
          <Input
            id="creator-engagement"
            name="engagementRate"
            type="number"
            min={0}
            max={100}
            step={0.1}
            defaultValue={0}
          />
          {fieldError("engagementRate") && (
            <p className="mt-1 text-xs text-red-400">{fieldError("engagementRate")}</p>
          )}
        </div>

        <div className="flex items-end">
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Adicionar ao CRM
          </Button>
        </div>

        {error && <p className="text-xs text-red-400 sm:col-span-2 lg:col-span-4">{error}</p>}
        {success && (
          <p className="text-xs text-emerald-400 sm:col-span-2 lg:col-span-4" role="status">
            {success}
          </p>
        )}
      </form>
    </details>
  );
}
