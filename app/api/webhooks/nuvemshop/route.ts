import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { marketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import { enqueueSaleIngestion } from "@/lib/async/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validSignature(rawBody: string, request: Request): boolean {
  const secret = process.env.NUVEMSHOP_WEBHOOK_SECRET?.trim();
  if (!secret) return true;
  const presented =
    request.headers.get("x-webhook-signature") ?? request.headers.get("x-signature") ?? "";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = presented.replace(/^sha256=/, "");
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!validSignature(rawBody, request)) return new NextResponse(null, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const shopId =
    request.headers.get("x-linked-store-id") ??
    request.headers.get("x-store-id") ??
    (body.store_id ? String(body.store_id) : null);
  const orderId = body.id !== undefined ? String(body.id) : null;
  if (!shopId || !orderId) return NextResponse.json({ received: true, ignored: true });
  const connector = await marketplaceRepository.findByShopId("NUVEMSHOP", shopId);
  if (!connector) return NextResponse.json({ received: true, ignored: true });
  const topic =
    request.headers.get("x-webhook-topic") ?? request.headers.get("x-topic") ?? "orders/created";
  const externalEventId = `nuvemshop:${shopId}:${topic}:${orderId}:${request.headers.get("x-webhook-id") ?? "delivery"}`;
  if (await marketplaceRepository.hasEvent(connector.organizationId, "NUVEMSHOP", externalEventId))
    return NextResponse.json({ received: true, duplicate: true });
  await marketplaceRepository.recordEvent(connector.organizationId, {
    provider: "NUVEMSHOP",
    externalEventId,
    connectorId: connector.id,
    topic,
    payload: body as Prisma.InputJsonValue,
  });
  try {
    await enqueueSaleIngestion({
      organizationId: connector.organizationId,
      provider: "NUVEMSHOP",
      externalEventId,
    });
  } catch (error) {
    console.error("[webhooks.nuvemshop] enqueue deferred", error);
  }
  return NextResponse.json({ received: true });
}
