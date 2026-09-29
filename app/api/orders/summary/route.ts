import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/session";
import { salesService } from "@/modules/sales/sales.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const organizationId = await requireOrganization();
    const summary = await salesService.summary(organizationId);
    return NextResponse.json({ summary }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: "Falha ao calcular resumo de pedidos" }, { status: 500 });
  }
}
