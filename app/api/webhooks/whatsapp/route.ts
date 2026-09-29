import { NextResponse } from "next/server";
import { whatsappWebhookHandler } from "@/modules/delivery/whatsapp/webhook";
import {
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from "@/modules/delivery/core/webhook-security";

export const runtime = "nodejs";

/**
 * WhatsApp Business Cloud API webhook ingress (official Meta platform only).
 *
 * GET — subscription handshake (verify token + challenge echo).
 * POST — signature FIRST: X-Hub-Signature-256 over the raw body; any
 * mismatch is an immediate 401, before parsing or persistence.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = verifyMetaWebhookChallenge({
    mode: url.searchParams.get("hub.mode"),
    verifyToken: url.searchParams.get("hub.verify_token"),
    challenge: url.searchParams.get("hub.challenge"),
  });
  if (challenge === null) return new NextResponse(null, { status: 401 });
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyMetaWebhookSignature({ rawBody, signature })) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    await whatsappWebhookHandler.handle(rawBody);
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("[whatsapp.webhook]", error instanceof Error ? error.message : "handler failed");
    return new NextResponse(null, { status: 400 });
  }
}
