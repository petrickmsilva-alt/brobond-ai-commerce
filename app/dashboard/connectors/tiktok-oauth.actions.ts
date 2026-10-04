"use server";

import { plantOAuthStateCookie } from "@/lib/oauth-state-cookie";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import {
  TIKTOK_LOGIN_STATE_COOKIE,
  TIKTOK_LOGIN_STATE_TTL_SECONDS,
  TikTokLoginConfigError,
} from "@/modules/connectors/tiktok/auth/login-kit.config";
import { createTikTokAuthorization } from "@/modules/connectors/tiktok/auth/login-kit.repository";

/**
 * TikTok Login Kit v2 — server action that mints the Sandbox consent URL.
 *
 * The client never sees the client key/secret: it receives only the final
 * `tiktok.com` URL and performs the top-level navigation itself (TikTok's
 * consent page cannot be framed or fetched).
 *
 * RBAC: ADMIN only — connecting a channel writes tenant credentials.
 * TENANT: `organizationId` comes from the session, never from the client.
 */
export type TikTokAuthorizationActionResult =
  { ok: true; authorizationUrl: string } | { ok: false; error: string };

export async function startTikTokLoginAction(): Promise<TikTokAuthorizationActionResult> {
  try {
    const { organizationId } = await requireAdmin();
    const { url, state } = await createTikTokAuthorization(organizationId);

    // HttpOnly double-submit cookie validated by the callback route.
    await plantOAuthStateCookie({
      name: TIKTOK_LOGIN_STATE_COOKIE,
      value: state,
      maxAge: TIKTOK_LOGIN_STATE_TTL_SECONDS,
    });

    return { ok: true, authorizationUrl: url };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: "Você não tem permissão para conectar o TikTok." };
    }
    if (error instanceof TikTokLoginConfigError) {
      return {
        ok: false,
        error:
          error.code === "MISSING_CREDENTIALS"
            ? "Credenciais do Login Kit v2 ausentes. Configure TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET."
            : "A URL de retorno do TikTok está desalinhada. Configure TIKTOK_REDIRECT_URI como APP_URL + /api/connectors/tiktok/callback, sem barra final.",
      };
    }
    console.error("[tiktok.login.action]", error);
    return { ok: false, error: "Não foi possível iniciar a conexão com o TikTok." };
  }
}
