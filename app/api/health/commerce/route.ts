import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/session";
import { getCommerceHealthSnapshot } from "@/modules/payments/health.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const organizationId = await requireOrganization();
    const snapshot = await getCommerceHealthSnapshot(organizationId);
    return NextResponse.json(snapshot, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ error: "Falha ao verificar saúde do checkout" }, { status: 500 });
  }
}
