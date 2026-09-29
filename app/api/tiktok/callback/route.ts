import { NextResponse } from "next/server";
import { exchangeCode } from "@/modules/connectors/tiktok/auth/oauth.service";
import { tiktokOAuthCallbackSchema } from "@/modules/connectors/tiktok/validators";

export const runtime = "nodejs";

function redirectToDashboard(request: Request, result: "connected" | "error") {
  const url = new URL("/dashboard/tiktok", request.url);
  url.searchParams.set("oauth", result);
  return NextResponse.redirect(url);
}

/** Public OAuth callback. The opaque one-time state determines the tenant. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rejected = url.searchParams.get("error");
  if (rejected) return redirectToDashboard(request, "error");

  const parsed = tiktokOAuthCallbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  if (!parsed.success) return redirectToDashboard(request, "error");

  try {
    await exchangeCode(parsed.data);
    return redirectToDashboard(request, "connected");
  } catch (error) {
    // Never leak OAuth/provider errors (or any token-adjacent detail) through
    // the browser redirect. Operators can inspect the server-side audit trail.
    console.error(
      "[tiktok.oauth.callback]",
      error instanceof Error ? error.message : "exchange failed",
    );
    return redirectToDashboard(request, "error");
  }
}
