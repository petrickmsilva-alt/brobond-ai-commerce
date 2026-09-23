import { NextResponse } from "next/server";
import { instagramWebhookHandler } from "@/modules/delivery/instagram/webhook";
import {
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from "@/modules/delivery/core/webhook-security";

export const runtime = "nodejs";

/**
 * Instagram Business webhook ingress (official Meta platform only).
 *
 * GET — Meta subscription handshake: echoes `hub.challenge` when (and only
 * when) the verify token matches; every other attempt is a 401.
 *
 * POST — event ingress: the X-Hub-Signature-256 HMAC over the exact raw
 * body is validated FIRST; an invalid signature is rejected with an
 * immediate 401 before any parsing or database work.
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
    await instagramWebhookHandler.handle(rawBody);
    // Meta expects a fast 200 acknowledgement; retries stop afterwards.
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("[instagram.webhook]", error instanceof Error ? error.message : "handler failed");
    return new NextResponse(null, { status: 400 });
  }
}
