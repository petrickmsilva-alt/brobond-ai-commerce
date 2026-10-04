import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/session";
import {
  TIKTOK_LOGIN_STATE_COOKIE,
  TIKTOK_LOGIN_STATE_TTL_SECONDS,
} from "@/modules/connectors/tiktok/auth/login-kit.config";
import { createTikTokAuthorization } from "@/modules/connectors/tiktok/auth/login-kit.repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts the TikTok Login Kit v2 consent flow.
 *
 * Returns a single 302 straight to `tiktok.com` and plants the HttpOnly
 * state cookie that the callback validates (double-submit CSRF defence on
 * top of the hashed, single-use `ConnectorOAuthState` row).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url);
  try {
    const organizationId = await requireOrganization();
    const { url, state } = await createTikTokAuthorization(organizationId);

    const response = NextResponse.redirect(url, { status: 302 });
    response.cookies.set({
      name: TIKTOK_LOGIN_STATE_COOKIE,
      value: state,
      httpOnly: true,
      sameSite: "lax",
      secure: origin.protocol === "https:",
      path: "/",
      maxAge: TIKTOK_LOGIN_STATE_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    console.error(
      "[tiktok.login.authorize]",
      error instanceof Error ? error.message : "authorization failed",
    );
    return NextResponse.redirect(
      new URL("/dashboard/connectors/tiktok?oauth=error&reason=authorize", origin),
      { status: 302 },
    );
  }
}
