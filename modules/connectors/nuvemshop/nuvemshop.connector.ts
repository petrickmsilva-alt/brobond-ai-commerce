import "server-only";

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";
import { getNuvemshopConfig, fetchNuvemshopProducts } from "./nuvemshop.service";

export class NuvemshopConnectionRequiredError extends Error {
  readonly requiresReauth = true;

  constructor(message = "Conecte uma loja Nuvemshop antes de sincronizar este conector.") {
    super(message);
    this.name = "NuvemshopConnectionRequiredError";
  }
}

/**
 * Production Nuvemshop catalog adapter. It has no mock/simplified mode: every
 * sync resolves an encrypted seller token and calls the official Products API.
 */
export class NuvemshopConnector implements Connector {
  readonly platform: ConnectorPlatform = ConnectorPlatform.NUVEMSHOP;
  readonly name = "Nuvemshop";
  readonly implemented = true;

  async syncProducts(organizationId: string, limit = 50): Promise<NormalizedContent[]> {
    if (!organizationId.trim()) {
      throw new NuvemshopConnectionRequiredError(
        "A sincronização da Nuvemshop exige o escopo de uma organização.",
      );
    }

    // Environment lock: no catalog request is made unless the production app
    // credentials and static callback configured on Render are complete.
    const config = getNuvemshopConfig();
    const [{ prisma }, { marketplaceService }] = await Promise.all([
      import("@/lib/prisma"),
      import("@/modules/marketplace/core/connector.service"),
    ]);
    const { accessToken, shopId } = await marketplaceService.getValidAccessToken(
      organizationId,
      "NUVEMSHOP",
    );
    if (!shopId) throw new NuvemshopConnectionRequiredError();

    const items = await fetchNuvemshopProducts(accessToken, shopId, limit, config);
    await Promise.all(
      items.map(async (item) => {
        const raw = item.raw ?? {};
        const itemId = String(raw.itemId ?? "").trim();
        if (!itemId) return;
        const nuvemshopProductId = `${shopId}:${itemId}`;
        const rawPriceCents = Number(raw.priceCents ?? 0);
        const priceCents = Number.isFinite(rawPriceCents)
          ? Math.max(0, Math.round(rawPriceCents))
          : 0;
        const rawStock = Number(raw.stockQuantity ?? 0);
        const stockQuantity = Number.isFinite(rawStock) ? Math.max(0, Math.trunc(rawStock)) : 0;
        const data = {
          name: item.title,
          slug: `nuvemshop-${shopId}-${itemId}`.toLowerCase(),
          description: item.caption ?? null,
          // Keep provider identity immutable even when the merchant edits SKU.
          sku: `nuvemshop:${shopId}:${itemId}`,
          priceCents,
          currency: typeof raw.currency === "string" ? raw.currency : "BRL",
          imageUrl: item.thumbnailUrl ?? null,
          stockQuantity,
          status: raw.published === false ? ("DRAFT" as const) : ("ACTIVE" as const),
        };
        await prisma.product.upsert({
          where: {
            organizationId_nuvemshopProductId: { organizationId, nuvemshopProductId },
          },
          update: data,
          create: { ...data, organizationId, nuvemshopProductId },
        });
      }),
    );
    return items;
  }

  async fetchContent(options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    if (!options.organizationId) {
      throw new NuvemshopConnectionRequiredError(
        "A sincronização da Nuvemshop exige o escopo de uma organização.",
      );
    }
    return this.syncProducts(options.organizationId, options.limit ?? 50);
  }

  async testConnection(): Promise<ConnectorHealth> {
    try {
      getNuvemshopConfig();
      return {
        platform: this.platform,
        ok: true,
        implemented: true,
        message:
          "Aplicativo Nuvemshop de produção configurado. Conecte uma loja para validar o token.",
      };
    } catch {
      return {
        platform: this.platform,
        ok: false,
        implemented: true,
        message:
          "Configure NUVEMSHOP_CLIENT_ID, NUVEMSHOP_CLIENT_SECRET e NUVEMSHOP_REDIRECT_URI no servidor.",
      };
    }
  }
}
