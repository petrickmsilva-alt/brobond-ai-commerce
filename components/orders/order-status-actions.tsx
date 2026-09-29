"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleX, RotateCcw, Wallet } from "lucide-react";
import { SaleStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";

interface OrderStatusActionsProps {
  orderId: string;
  status: SaleStatus;
}

export function OrderStatusActions({ orderId, status }: OrderStatusActionsProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  async function updateStatus(nextStatus: SaleStatus) {
    setPending(nextStatus);
    try {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, status: nextStatus }),
      });

      if (!response.ok) {
        throw new Error("status-update-failed");
      }

      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === SaleStatus.PENDING && (
        <Button
          type="button"
          size="xs"
          variant="primary"
          onClick={() => updateStatus(SaleStatus.PAID)}
          disabled={pending !== null}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {pending === SaleStatus.PAID ? "Atualizando..." : "Marcar pago"}
        </Button>
      )}

      {status === SaleStatus.PAID && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => updateStatus(SaleStatus.REFUNDED)}
          disabled={pending !== null}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {pending === SaleStatus.REFUNDED ? "Reembolsando..." : "Reembolsar"}
        </Button>
      )}

      {status !== SaleStatus.CANCELLED && status !== SaleStatus.REFUNDED && (
        <Button
          type="button"
          size="xs"
          variant="danger"
          onClick={() => updateStatus(SaleStatus.CANCELLED)}
          disabled={pending !== null}
        >
          <CircleX className="h-3.5 w-3.5" />
          {pending === SaleStatus.CANCELLED ? "Cancelando..." : "Cancelar"}
        </Button>
      )}

      {status === SaleStatus.REFUNDED && (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/45">
          <Wallet className="h-3.5 w-3.5" />
          Reembolsado
        </span>
      )}
    </div>
  );
}
