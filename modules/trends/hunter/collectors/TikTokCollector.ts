/**
 * TikTok Trend Collector (PR012).
 *
 * Real connection logic using official TikTok Open API endpoints and
 * environment credentials (TIKTOK_APP_KEY, TIKTOK_APP_SECRET).
 */

import { TrendSource } from "@prisma/client";
import type { TrendCandidate, TrendCollector } from "../../interfaces/trend.interface";
import { ConnectorConfigError, ProviderApiError } from "@/modules/marketplace/core/errors";

const TIKTOK_API_BASE_URL = "https://open-api.tiktokglobalshop.com";
const PROVIDER = "TIKTOK" as const;

export class TikTokCollector implements TrendCollector {
  readonly source: TrendSource = TrendSource.TIKTOK;

  async collect(): Promise<TrendCandidate[]> {
    const appKey = process.env.TIKTOK_APP_KEY?.trim();
    const appSecret = process.env.TIKTOK_APP_SECRET?.trim();
    if (!appKey || !appSecret) {
      throw new ConnectorConfigError("TIKTOK_APP_KEY / TIKTOK_APP_SECRET", PROVIDER);
    }

    const baseUrl = process.env.TIKTOK_API_BASE_URL?.trim() || TIKTOK_API_BASE_URL;
    const url = new URL("/open_api/v1.3/trends/keywords", baseUrl);
    url.searchParams.set("app_key", appKey);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-tts-access-token": appSecret,
        },
        cache: "no-store",
      });
    } catch {
      throw new ProviderApiError("Falha de rede ao conectar à API de Trends do TikTok.", 503, PROVIDER);
    }

    if (!response.ok) {
      throw new ProviderApiError(
        `A API do TikTok retornou status ${response.status}`,
        response.status,
        PROVIDER,
      );
    }

    const payload = (await response.json().catch(() => undefined)) as
      | {
          data?: {
            trends?: Array<{
              keyword: string;
              category?: string;
              views?: number;
              likes?: number;
              shares?: number;
              margin?: number;
              saturation?: number;
            }>;
          };
        }
      | undefined;

    const trends = payload?.data?.trends ?? [];
    return trends.map((item) => ({
      keyword: item.keyword,
      category: (item.category as TrendCandidate["category"]) || "Moda",
      views: item.views ?? 0,
      likes: item.likes ?? 0,
      shares: item.shares ?? 0,
      margin: item.margin ?? 50,
      saturation: item.saturation ?? 20,
    }));
  }

  /** PR002 retrocompatible alias. */
  collectDailyTrends(): Promise<TrendCandidate[]> {
    return this.collect();
  }
}
