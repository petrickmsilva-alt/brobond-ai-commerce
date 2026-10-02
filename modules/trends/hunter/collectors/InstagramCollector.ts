/**
 * Instagram Trend Collector (PR012).
 *
 * Real connection logic using official Meta Graph API endpoints and
 * environment credentials (META_APP_ID, META_APP_SECRET).
 */

import { TrendSource } from "@prisma/client";
import type { TrendCandidate, TrendCollector } from "../../interfaces/trend.interface";
import { ConnectorConfigError, ProviderApiError } from "@/modules/marketplace/core/errors";

const META_GRAPH_BASE_URL = "https://graph.facebook.com";
const META_GRAPH_VERSION = "v21.0";
const PROVIDER = "INSTAGRAM" as const;

export class InstagramCollector implements TrendCollector {
  readonly source: TrendSource = TrendSource.INSTAGRAM;

  async collect(): Promise<TrendCandidate[]> {
    const appId = process.env.META_APP_ID?.trim();
    const appSecret = process.env.META_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      throw new ConnectorConfigError("META_APP_ID / META_APP_SECRET", PROVIDER);
    }

    const base = process.env.META_GRAPH_API_BASE_URL?.trim() || META_GRAPH_BASE_URL;
    const version = process.env.META_GRAPH_API_VERSION?.trim() || META_GRAPH_VERSION;
    const url = new URL(`${base.replace(/\/$/, "")}/${version}/ig_hashtag_search`);
    url.searchParams.set("access_token", `${appId}|${appSecret}`);
    url.searchParams.set("q", "tendencias");

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      throw new ProviderApiError("Falha de rede ao conectar à Graph API do Instagram.", 503, PROVIDER);
    }

    if (!response.ok) {
      throw new ProviderApiError(
        `A API do Instagram retornou status ${response.status}`,
        response.status,
        PROVIDER,
      );
    }

    const payload = (await response.json().catch(() => undefined)) as
      | { data?: Array<{ id: string; name?: string; media_count?: number }> }
      | undefined;

    const data = payload?.data ?? [];
    return data.map((item) => ({
      keyword: item.name ?? `hashtag-${item.id}`,
      category: "Moda",
      views: item.media_count ?? 0,
      likes: Math.round((item.media_count ?? 0) * 0.1),
      shares: Math.round((item.media_count ?? 0) * 0.02),
      margin: 60,
      saturation: 20,
    }));
  }

  /** PR002 retrocompatible alias. */
  collectDailyTrends(): Promise<TrendCandidate[]> {
    return this.collect();
  }
}
