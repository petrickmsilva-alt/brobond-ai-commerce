"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { connectTikTok, revokeConnection } from "@/modules/connectors/tiktok/auth/oauth.service";
import type { TikTokActionResult, TikTokSyncResult } from "@/modules/connectors/tiktok/dto";
import { tiktokImporter } from "@/modules/connectors/tiktok/sync/importer";
import { tiktokDisconnectSchema } from "@/modules/connectors/tiktok/validators";

const PATH = "/dashboard/tiktok";

function fail(error: unknown): TikTokActionResult<never> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: "Dados inválidos.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "A conexão do TikTok Shop exige perfil ADMIN." };
  }
  console.error("[tiktok.actions]", error instanceof Error ? error.message : "unexpected error");
  return { ok: false, error: "Não foi possível concluir a operação com TikTok Shop." };
}

/** Begins server-side OAuth. The browser receives only the provider redirect URL. */
export async function connectTikTokAction(): Promise<
  TikTokActionResult<{ authorizationUrl: string }>
> {
  try {
    const user = await requireAdmin();
    const data = await connectTikTok(user.organizationId);
    return { ok: true, data };
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
      : { ok: false, error: "Conta TikTok Shop não encontrada neste workspace." };
  } catch (error) {
    return fail(error);
  }
}
