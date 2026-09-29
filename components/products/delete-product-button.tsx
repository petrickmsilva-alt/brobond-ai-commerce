"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deleteProductAction } from "@/app/dashboard/products/actions";

/**
 * ADMIN-only delete with inline confirmation (RBAC re-checked server-side).
 */
export function DeleteProductButton({
  productId,
  name,
  redirectTo,
}: {
  productId: string;
  name: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteProductAction(productId);
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="rounded-md bg-red-500/15 px-2 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirmar"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-md px-2 py-1 text-xs text-white/50 hover:text-white"
        >
          Cancelar
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      {error && <span className="text-[10px] text-red-300">{error}</span>}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Excluir ${name}`}
        className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-red-500/15 hover:text-red-300"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
