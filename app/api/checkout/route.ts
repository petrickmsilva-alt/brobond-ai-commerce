import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/session";
import { checkoutCreateSchema } from "@/modules/payments/provider";
import { createCheckoutSession } from "@/modules/payments/checkout.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const organizationId = await requireOrganization();
    const payload = await request.json().catch(() => null);
    const parsed = checkoutCreateSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "payload inválido",
          issues: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await createCheckoutSession({
      ...parsed.data,
      organizationId,
      metadata: {
        ...(parsed.data.metadata ?? {}),
        source: "checkout-api",
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: "Falha ao criar checkout",
      },
      { status: 500 },
    );
  }
}
