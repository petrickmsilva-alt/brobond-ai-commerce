import type { TikTokApiClient } from "./client";

export interface TikTokCreator {
  id?: string;
  creator_id?: string;
  open_id?: string;
  username?: string;
  handle?: string;
  nickname?: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  follower_count?: number;
  followers?: number;
  average_video_views?: number;
  avg_views?: number;
  engagement_rate?: number;
  category?: string;
  [key: string]: unknown;
}

interface TikTokCreatorPage {
  creators?: TikTokCreator[];
  creator_infos?: TikTokCreator[];
  next_page_token?: string;
}

/**
 * Official Affiliate Seller marketplace endpoint. The endpoint requires the
 * Affiliate Seller scope to be enabled in Partner Center; a missing scope is
 * surfaced as a typed API error rather than silently falling back to scraping.
 */
export async function getCreators(
  client: TikTokApiClient,
  input: { accessToken: string; shopCipher: string; pageSize?: number; pageToken?: string },
): Promise<{ creators: TikTokCreator[]; nextPageToken?: string }> {
  const data = await client.request<TikTokCreatorPage>({
    path: "/affiliate_seller/202508/marketplace/creators/search",
    method: "POST",
    accessToken: input.accessToken,
    shopCipher: input.shopCipher,
    query: {
      page_size: input.pageSize ?? 50,
      ...(input.pageToken ? { page_token: input.pageToken } : {}),
    },
    body: {},
  });
  return {
    creators: data.creators ?? data.creator_infos ?? [],
    nextPageToken: data.next_page_token,
  };
}
