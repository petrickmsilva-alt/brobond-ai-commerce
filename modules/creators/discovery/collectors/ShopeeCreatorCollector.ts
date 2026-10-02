/**
 * Shopee Creator Collector (PR012).
 *
 * Real connection logic using Shopee Affiliate / KOL API
 * and environment credentials (SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY).
 */

import { CreatorSource } from "@prisma/client";
import type { CreatorCandidate, CreatorCollector } from "../../interfaces/creator.interface";
import { ConnectorConfigError, ProviderApiError } from "@/modules/marketplace/core/errors";
import { shopeeSign } from "@/modules/marketplace/shopee/shopee.service";

const SHOPEE_API_BASE_URL = "https://partner.shopeemobile.com";
const PROVIDER = "SHOPEE" as const;

export class ShopeeCreatorCollector implements CreatorCollector {
  readonly source: CreatorSource = CreatorSource.SHOPEE;

  async collect(): Promise<CreatorCandidate[]> {
    const partnerIdRaw = process.env.SHOPEE_PARTNER_ID?.trim();
    const partnerKey = process.env.SHOPEE_PARTNER_KEY?.trim();
    const partnerId = Number(partnerIdRaw);

    if (!partnerIdRaw || !partnerKey || !Number.isInteger(partnerId) || partnerId <= 0) {
      throw new ConnectorConfigError("SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY", PROVIDER);
    }

    const baseUrl = process.env.SHOPEE_API_BASE_URL?.trim() || SHOPEE_API_BASE_URL;
    const path = "/api/v2/affiliate/kol_list";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = shopeeSign({ partnerId, partnerKey, apiBaseUrl: baseUrl }, path, timestamp);

    const url = new URL(path, baseUrl);
    url.searchParams.set("partner_id", String(partnerId));
    url.searchParams.set("timestamp", String(timestamp));
    url.searchParams.set("sign", sign);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      throw new ProviderApiError("Falha de rede ao buscar creators na Shopee.", 503, PROVIDER);
    }

    if (!response.ok) {
      throw new ProviderApiError(
        `A API da Shopee retornou status ${response.status}`,
        response.status,
        PROVIDER,
      );
    }

    const payload = (await response.json().catch(() => undefined)) as
      | {
          response?: {
            kols?: Array<{
              kol_id: string;
              username: string;
              nickname?: string;
              avatar?: string;
              followers?: number;
              avg_views?: number;
              engagement_rate?: number;
              posts_per_week?: number;
              growth_rate?: number;
              quality_score?: number;
            }>;
          };
        }
      | undefined;

    const kols = payload?.response?.kols ?? [];
    return kols.map((k) => ({
      externalId: `shopee:${k.kol_id}`,
      handle: `@${k.username.replace(/^@/, "").toLowerCase()}`,
      displayName: k.nickname || k.username,
      avatarUrl: k.avatar || undefined,
      followers: k.followers ?? 5_000,
      avgViews: k.avg_views ?? 2_500,
      engagementRate: k.engagement_rate ?? 4.0,
      postsPerWeek: k.posts_per_week ?? 5.0,
      growthRate: k.growth_rate ?? 2.0,
      qualityScore: k.quality_score ?? 75,
      niche: "Casual",
      tags: ["shopee", "afiliado", "kol"],
    }));
  }
}
