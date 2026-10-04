import { NextResponse } from "next/server";
import { connectorOAuthStateService } from "@/modules/marketplace/core/oauth-state.service";
import { TIKTOK_LOGIN_STATE_COOKIE } from "@/modules/connectors/tiktok/auth/login-kit.config";
import { completeTikTokLogin } from "@/modules/connectors/tiktok/auth/login-kit.repository";
import {
  TIKTOK_LOGIN_PROVIDER,
  isMatchingState,
  TikTokLoginError,
  type TikTokLoginFailureReason,
} from "@/modules/connectors/tiktok/auth/login-kit.service";
import { tiktokLoginCallbackSchema } from "@/modules/connectors/tiktok/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DASHBOARD_PATH = "/dashboard/connectors/tiktok";

/**
 * TikTok Login Kit v2 callback — the exact redirect URI registered in the
 * TikTok Developers Sandbox panel:
 * `http://localhost:3000/api/connectors/tiktok/callback`.
 *
 * Contract enforced here:
 *   · one single 302 back into the dashboard (never a redirect chain, never
 *     a redirect back to an OAuth endpoint), so TikTok's handler validation
 *     always observes a clean 200/302 sequence;
 *   · the `state` is checked against the HttpOnly cookie AND against the
 *     hashed, single-use `ConnectorOAuthState` row that resolves the tenant;
 *   · the authorization code is exchanged server-side only.
 */
function finish(request: Request, result: "connected" | "error", reason?: string): NextResponse {
  const url = new URL(DASHBOARD_PATH, new URL(request.url).origin);
  url.searchParams.set("oauth", result);
  if (reason) url.searchParams.set("reason", reason);
  const response = NextResponse.redirect(url, { status: 302 });
  // The state cookie is single-use: clear it on every terminal outcome.
  response.cookies.set({
    name: TIKTOK_LOGIN_STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);

  // 1. The user denied consent (or TikTok reported an error) — no exchange.
  const providerError = url.searchParams.get("error");
  if (providerError) {
    console.error("[tiktok.login.callback] provider error", providerError);
    return finish(request, "error", "denied");
  }

  // 2. Strictly validate the inbound query parameters.
  const parsed = tiktokLoginCallbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  if (!parsed.success) return finish(request, "error", "invalid_request");
  const { code, state } = parsed.data;

  // 3. CSRF — double submit: cookie state must match the redirect state.
  const cookieState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TIKTOK_LOGIN_STATE_COOKIE}=`))
    ?.slice(TIKTOK_LOGIN_STATE_COOKIE.length + 1);
  if (!cookieState || !isMatchingState(decodeURIComponent(cookieState), state)) {
    return finish(request, "error", "state_mismatch");
  }

  try {
    // 4. CSRF — server side: consume the hashed, single-use state row. It is
    //    the ONLY thing that resolves the tenant (never a query parameter).
    const { organizationId } = await connectorOAuthStateService.consume(
      state,
      TIKTOK_LOGIN_PROVIDER,
    );

    // 5. Form-urlencoded POST to tiktokapis.com + encrypted Prisma upsert.
    await completeTikTokLogin(organizationId, code);

    return finish(request, "connected");
  } catch (error) {
    const reason: TikTokLoginFailureReason | "exchange" =
      error instanceof TikTokLoginError ? error.reason : "exchange";
    console.error(
      "[tiktok.login.callback]",
      reason,
      error instanceof Error ? error.message : "callback failed",
    );
    return finish(request, "error", reason);
  }
}
