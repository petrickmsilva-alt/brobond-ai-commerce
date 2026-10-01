"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import type {
  MarketplaceActionResult,
  MarketplaceSyncResultDTO,
} from "@/modules/marketplace/core/connector.dto";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import {
  connectorProviderSchema,
  mercadoPagoConnectSchema,
  syncMarketplaceSchema,
} from "@/modules/marketplace/core/connector.validator";
import {
  ConnectorNotConnectedError,
  MarketplaceError,
} from "@/modules/marketplace/core/errors";
import { marketplaceSyncService } from "@/modules/marketplace/core/sync.service";
import type { ConnectorProvider } from "@prisma/client";

/**
 * Marketplace server actions (PR012) — the ONLY write path from the
 * connectors grid to the marketplace module.
 *
 * RBAC (enforced server-side on every action): ADMIN connects, syncs and
 * disconnects; MANAGER/MEMBER are read-only (the UI hides the affordances).
 *
 * TENANT: `organizationId` always comes from the authenticated session and
 * is passed as the first argument of every service call. It is NEVER
 * accepted from the client.
 */

const CONNECTORS_PATH = "/dashboard/connectors";

function fail(error: unknown): MarketplaceActionResult<never> {
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
  if (error instanceof ConnectorNotConnectedError || error instanceof MarketplaceError) {
    return { ok: false, error: error.message };
  }
  console.error("[marketplace.actions]", error);
  return { ok: false, error: "Erro inesperado. Tente novamente." };
}

/**
 * Start an OAuth2 connection: returns the provider's official authorization
 * URL — the client then redirects the browser. ADMIN only.
 */
export async function startProviderOAuthAction(
  input: unknown,
): Promise<MarketplaceActionResult<{ authorizationUrl: string }>> {
  try {
    const { organizationId } = await requireAdmin();
    const provider = connectorProviderSchema.parse(input);
    const result = await marketplaceService.startOAuth(
      organizationId,
      provider as ConnectorProvider,
    );
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Run a REAL sync for one provider: resolves a valid credential (refreshing
 * it when needed), fetches the live catalog/billing feed from the official
 * API and consolidates imported/duplicated/failed counters on the tenant's
 * Connector row. ADMIN only.
 */
export async function syncProviderAction(
  input: unknown,
): Promise<MarketplaceActionResult<MarketplaceSyncResultDTO>> {
  try {
    const { organizationId } = await requireAdmin();
    const { provider, limit } = syncMarketplaceSchema.parse(input);
    const result = await marketplaceSyncService.syncProvider(
      organizationId,
      provider as ConnectorProvider,
      limit,
    );
    revalidatePath(CONNECTORS_PATH);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** Revoke one provider connection (wipes every stored ciphertext). ADMIN only. */
export async function disconnectProviderAction(
  input: unknown,
): Promise<MarketplaceActionResult<{ provider: ConnectorProvider }>> {
  try {
    const { organizationId } = await requireAdmin();
    const provider = connectorProviderSchema.parse(input) as ConnectorProvider;
    await marketplaceService.disconnect(organizationId, provider);
    revalidatePath(CONNECTORS_PATH);
    return { ok: true, data: { provider } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Connect Mercado Pago with production API keys: the Access Token is
 * validated against the official API before being persisted (encrypted).
 * ADMIN only.
 */
export async function connectMercadoPagoAction(
  input: unknown,
): Promise<MarketplaceActionResult<{ shopName: string | null }>> {
  try {
    const { organizationId } = await requireAdmin();
    const credentials = mercadoPagoConnectSchema.parse(input);
    const connector = await marketplaceService.connectMercadoPago(organizationId, credentials);
    revalidatePath(CONNECTORS_PATH);
    return { ok: true, data: { shopName: connector.shopName } };
  } catch (error) {
    return fail(error);
  }
}
