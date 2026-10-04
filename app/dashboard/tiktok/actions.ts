"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { plantOAuthStateCookie } from "@/lib/oauth-state-cookie";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import { TikTokLoginConfigError } from "@/modules/connectors/tiktok/auth/login-kit.config";
import { revokeConnection } from "@/modules/connectors/tiktok/auth/oauth.service";
import type { TikTokActionResult, TikTokSyncResult } from "@/modules/connectors/tiktok/dto";
import { tiktokImporter } from "@/modules/connectors/tiktok/sync/importer";
import { tiktokDisconnectSchema } from "@/modules/connectors/tiktok/validators";
import { TikTokPendingApprovalError } from "@/modules/connectors/tiktok/pending-approval.service";

const PATH = "/dashboard/tiktok";

function fail(error: unknown): TikTokActionResult<never> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      error: "Dados inválidos.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  if (error instanceof AuthorizationError) {
    return {
      ok: false,
      code: "FORBIDDEN",
      error: "A conexão do TikTok exige perfil ADMIN.",
    };
  }
  if (error instanceof TikTokPendingApprovalError) {
    return { ok: false, code: "PENDING_APPROVAL", error: error.message };
  }
  if (error instanceof TikTokLoginConfigError) {
    if (error.code === "MISSING_CREDENTIALS") {
      return {
        ok: false,
        code: "LOGIN_KIT_NOT_CONFIGURED",
        error:
          "O Login Kit v2 do TikTok não está configurado. Defina TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET na Render.",
      };
    }
    return {
      ok: false,
      code: "CALLBACK_MISALIGNED",
      error:
        "A URL de retorno do TikTok está desalinhada. TIKTOK_REDIRECT_URI deve ser APP_URL + /api/connectors/tiktok/callback, sem barra final.",
    };
  }
  console.error("[tiktok.actions]", error instanceof Error ? error.message : "unexpected error");
  return {
    ok: false,
    code: "UNEXPECTED",
    error: "Não foi possível concluir a operação com TikTok.",
  };
}

/**
 * Begins server-side OAuth. The browser receives only the provider redirect
 * URL — never the client key or secret.
 *
 * Both TikTok connect affordances (this screen and the connectors grid card)
 * funnel through `marketplaceService.startOAuth("TIKTOK")`, so there is
 * exactly ONE place that decides which TikTok gateway the panel talks to:
 * Login Kit v2 on `tiktok.com`.
 */
export async function connectTikTokAction(): Promise<
  TikTokActionResult<{ authorizationUrl: string }>
> {
  try {
    const user = await requireAdmin();
    const { authorizationUrl, stateCookie } = await marketplaceService.startOAuth(
      user.organizationId,
      "TIKTOK",
    );
    if (stateCookie) await plantOAuthStateCookie(stateCookie);
    return { ok: true, data: { authorizationUrl } };
  } catch (error) {
    return fail(error);
  }
}

/** Runs the official API importer for every connected shop in this tenant. */
export async function syncTikTokAction(): Promise<TikTokActionResult<TikTokSyncResult>> {
  try {
    const user = await requireAdmin();
    const result = await tiktokImporter.sync(user.organizationId);
    revalidatePath(PATH);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** Immediately removes encrypted local credentials; ADMIN only. */
export async function disconnectTikTokAction(
  input: unknown,
): Promise<TikTokActionResult<{ disconnected: boolean }>> {
  try {
    const user = await requireAdmin();
    const { accountId } = tiktokDisconnectSchema.parse(input);
    const disconnected = await revokeConnection(user.organizationId, accountId);
    revalidatePath(PATH);
    return disconnected
      ? { ok: true, data: { disconnected: true } }
      : {
          ok: false,
          code: "NOT_FOUND",
          error: "Conta TikTok não encontrada neste workspace.",
        };
  } catch (error) {
    return fail(error);
  }
}
