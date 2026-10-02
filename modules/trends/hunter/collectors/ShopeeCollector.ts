/**
 * Shopee Trend Collector (PR012).
 *
 * Real connection logic using Shopee Open Platform v2 HMAC-SHA256 signature
 * and environment credentials (SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY).
 */

import { TrendSource } from "@prisma/client";
import type { TrendCandidate, TrendCollector } from "../../interfaces/trend.interface";
import { ConnectorConfigError, ProviderApiError } from "@/modules/marketplace/core/errors";
import { shopeeSign } from "@/modules/marketplace/shopee/shopee.service";

const SHOPEE_API_BASE_URL = "https://partner.shopeemobile.com";
const PROVIDER = "SHOPEE" as const;

export class ShopeeCollector implements TrendCollector {
  readonly source: TrendSource = TrendSource.SHOPEE;

  async collect(): Promise<TrendCandidate[]> {
    const partnerIdRaw = process.env.SHOPEE_PARTNER_ID?.trim();
    const partnerKey = process.env.SHOPEE_PARTNER_KEY?.trim();
    const partnerId = Number(partnerIdRaw);

    if (!partnerIdRaw || !partnerKey || !Number.isInteger(partnerId) || partnerId <= 0) {
      throw new ConnectorConfigError("SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY", PROVIDER);
    }

    const baseUrl = process.env.SHOPEE_API_BASE_URL?.trim() || SHOPEE_API_BASE_URL;
    const path = "/api/v2/search/get_recommend_keyword";
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
      throw new ProviderApiError("Falha de rede ao conectar à API da Shopee.", 503, PROVIDER);
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
            keywords?: Array<{
              keyword: string;
              category?: string;
              search_volume?: number;
              click_count?: number;
              sold_count?: number;
            }>;
          };
        }
      | undefined;

    const keywords = payload?.response?.keywords ?? [];
    return keywords.map((k) => ({
      keyword: k.keyword,
      category: (k.category as TrendCandidate["category"]) || "Moda",
      views: k.search_volume ?? 0,
      likes: k.click_count ?? 0,
      shares: k.sold_count ?? 0,
      margin: 55,
      saturation: 15,
    }));
  }

  /** PR002 retrocompatible alias. */
  collectDailyTrends(): Promise<TrendCandidate[]> {
    return this.collect();
  }
}
