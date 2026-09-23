import { NextResponse } from "next/server";
import { tiktokWebhookHandler } from "@/modules/connectors/tiktok/webhooks/handler";
import { verifyTikTokWebhookSignature } from "@/modules/connectors/tiktok/webhooks/verifier";

export const runtime = "nodejs";

/** TikTok Shop webhook ingress. Tokens are never accepted or returned here. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (
    !verifyTikTokWebhookSignature({
      rawBody,
      signature: request.headers.get("authorization"),
    })
  ) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    await tiktokWebhookHandler.handle(rawBody);
    // TikTok Shop expects a quick empty 200 acknowledgement.
    return new NextResponse(null, { status: 200 });
  } catch (error) {
    console.error("[tiktok.webhook]", error instanceof Error ? error.message : "handler failed");
    return new NextResponse(null, { status: 400 });
  }
}
