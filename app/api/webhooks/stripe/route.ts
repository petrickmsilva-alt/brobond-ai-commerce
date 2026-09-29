import { NextResponse } from "next/server";
import Stripe from "stripe";
import { salesService } from "@/modules/sales/sales.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook secret not configured" }, { status: 501 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing stripe-signature" }, { status: 400 });
  }

  try {
    const body = Buffer.from(await request.arrayBuffer());
    const event = Stripe.webhooks.constructEvent(body, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const saleId = session.metadata?.saleId;
      const organizationId = session.metadata?.organizationId;

      if (saleId && organizationId) {
        await salesService.markPaid(organizationId, saleId);
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: "invalid stripe webhook" }, { status: 400 });
  }
}
