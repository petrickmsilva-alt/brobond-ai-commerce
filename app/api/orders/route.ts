import { NextResponse } from "next/server";
import { SaleStatus } from "@prisma/client";
import { requireManager, requireOrganization } from "@/lib/session";
import { normalizeSaleStatus, salesService } from "@/modules/sales/sales.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const organizationId = await requireOrganization();
    const orders = await salesService.list(organizationId, { take: 50 });
    return NextResponse.json({ orders }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: "Falha ao listar pedidos" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireManager();
    const organizationId = await requireOrganization();
    const payload = await request.json().catch(() => null);

    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "payload inválido" }, { status: 400 });
    }

    const orderId = typeof payload.id === "string" ? payload.id.trim() : "";
    const status = typeof payload.status === "string" ? payload.status : null;

    if (!orderId || !status) {
      return NextResponse.json({ error: "id e status são obrigatórios" }, { status: 400 });
    }

    const normalizedStatus = normalizeSaleStatus(status as SaleStatus | string);
    const updatedOrder = await salesService.updateStatus(organizationId, orderId, normalizedStatus);

    if (!updatedOrder) {
      return NextResponse.json({ error: "pedido não encontrado" }, { status: 404 });
    }

    return NextResponse.json({ order: updatedOrder }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    if (error instanceof Error && error.message.includes("Forbidden")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    return NextResponse.json({ error: "Falha ao atualizar pedido" }, { status: 500 });
  }
}
