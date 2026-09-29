"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import type { ConnectorActionResult } from "@/modules/connectors/core/connector.dto";
import { getConnector } from "@/modules/connectors/core/connector.factory";
import type { ConnectorHealth } from "@/modules/connectors/core/connector.interface";
import { connectorRepository } from "@/modules/connectors/core/connector.repository";
import {
  connectorSyncJob,
  type ConnectorSyncResult,
} from "@/modules/connectors/core/connector.sync";
import {
  connectorPlatformSchema,
  syncConnectorSchema,
  toggleConnectorSchema,
} from "@/modules/connectors/core/connector.validator";
import type { ConnectorPlatform } from "@prisma/client";

/**
 * Connector server actions — the ONLY write path from the UI to the
 * connectors module.
 *
 * RBAC (enforced server-side on every action):
 *   ADMIN   → sincronizar · ativar/desativar conector
 *   MANAGER → visualizar (no write actions available)
 *   MEMBER  → somente leitura
 *
 * TENANT: `organizationId` always comes from the authenticated session
 * (`requireAdmin()` returns a guaranteed tenant) and is passed as the first
 * argument of every repository call. It is NEVER accepted from the client.
 *
 * PR005 integrates NO real API: syncing a placeholder platform records a
 * failure on `ConnectorStatus` instead of calling anything.
 */

const CONNECTORS_PATH = "/dashboard/connectors";

function fail(error: unknown): ConnectorActionResult<never> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: "Dados inválidos. Revise os campos destacados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "Você não tem permissão para executar esta ação." };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return { ok: false, error: "Já existe um registro equivalente para este workspace." };
  }
  console.error("[connectors.actions]", error);
  return { ok: false, error: "Erro inesperado. Tente novamente." };
}

/**
 * Run the `sync-connector` job for one platform (manual trigger — there is
 * no cron in PR005). ADMIN only.
 */
export async function syncConnectorAction(
  input: unknown,
): Promise<ConnectorActionResult<ConnectorSyncResult>> {
  try {
    const { organizationId } = await requireAdmin(); // ADMIN: executa sincronização
    const { platform, limit } = syncConnectorSchema.parse(input);

    const job = connectorSyncJob;
    const result = await job.run(organizationId, platform as ConnectorPlatform);

    revalidatePath(CONNECTORS_PATH);

    if (result.status === "failed") {
      return {
        ok: false,
        error: `A sincronização falhou: ${result.error ?? "erro desconhecido"}.`,
      };
    }
    // `limit` is part of the validated contract even though the default job
    // instance uses its own cap — kept explicit so a future PR can thread it.
    void limit;
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** Enable or disable one connector for the workspace. ADMIN only. */
export async function toggleConnectorAction(
  input: unknown,
): Promise<ConnectorActionResult<{ platform: ConnectorPlatform; enabled: boolean }>> {
  try {
    const { organizationId } = await requireAdmin(); // ADMIN: ativa/desativa
    const { platform, enabled } = toggleConnectorSchema.parse(input);

    const status = await connectorRepository.setEnabled(
      organizationId,
      platform as ConnectorPlatform,
      enabled,
    );

    revalidatePath(CONNECTORS_PATH);
    return { ok: true, data: { platform: status.platform, enabled: status.enabled } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Probe one connector. Never performs network access in PR005 — the mock
 * reports healthy, the three placeholders report "não implementado".
 * ADMIN only (it is a diagnostic affordance, not a read of tenant data).
 */
export async function testConnectorAction(
  input: unknown,
): Promise<ConnectorActionResult<ConnectorHealth>> {
  try {
    await requireAdmin(); // ADMIN: diagnóstico
    const platform = connectorPlatformSchema.parse(input);
    const health = await getConnector(platform as ConnectorPlatform).testConnection();
    return { ok: true, data: health };
  } catch (error) {
    return fail(error);
  }
}
