import { NextResponse } from "next/server";
import { isConnectorProviderName } from "@/modules/marketplace/core/providers";
import { WebhookSignatureError } from "@/modules/marketplace/core/errors";
import {
  handleProviderWebhook,
  verifyMetaHandshake,
} from "@/modules/marketplace/webhooks/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

/**
 * Unified provider webhook ingress (PR012).
 *
 * Static siblings (`/api/webhooks/tiktok`, `/api/webhooks/instagram`, …)
 * keep precedence for their specialized flows; this dynamic route serves
 * the marketplace providers (Shopee, Mercado Livre, Mercado Pago) and any
 * provider without a dedicated static route, listening to real platform
 * events: clothing catalog updates, new fashion orders and payment/billing
 * status changes.
 *
 * GET  — provider verification handshakes (Meta hub.challenge; other
 *        providers receive a plain liveness 200).
 * POST — signature-verified, tenant-resolved, idempotent ingestion into
 *        the ConnectorEvent inbox. Providers always get a fast 200 once
 *        the event is durably stored.
 */
export async function GET(request: Request, context: RouteContext) {
  const { provider } = await context.params;
  const normalized = provider?.toUpperCase();
  if (!normalized || !isConnectorProviderName(normalized)) {
    return new NextResponse(null, { status: 404 });
  }

  if (normalized === "INSTAGRAM") {
    const challenge = verifyMetaHandshake(new URL(request.url));
    if (challenge !== null) {
      return new NextResponse(challenge, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    return new NextResponse(null, { status: 403 });
  }

  return NextResponse.json({ ok: true, provider: normalized });
}

export async function POST(request: Request, context: RouteContext) {
  const { provider } = await context.params;
  const normalized = provider?.toUpperCase();
  if (!normalized || !isConnectorProviderName(normalized)) {
    return new NextResponse(null, { status: 404 });
  }

  const rawBody = await request.text();
  try {
    const result = await handleProviderWebhook(normalized, request, rawBody);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      return new NextResponse(null, { status: 401 });
    }
    console.error(
      `[webhooks.${normalized.toLowerCase()}]`,
      error instanceof Error ? error.message : "handler failed",
    );
    return new NextResponse(null, { status: 400 });
  }
}
