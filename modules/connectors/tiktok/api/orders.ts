import type { TikTokApiClient } from "./client";

export interface TikTokOrder {
  id?: string;
  order_id?: string;
  status?: string;
  create_time?: number;
  update_time?: number;
  [key: string]: unknown;
}

interface TikTokOrderPage {
  orders?: TikTokOrder[];
  order_list?: TikTokOrder[];
  next_page_token?: string;
}

/** Official Order API v202309: POST /order/202309/orders/search. */
export async function getOrders(
  client: TikTokApiClient,
  input: {
    accessToken: string;
    shopCipher: string;
    pageSize?: number;
    pageToken?: string;
    updatedSince?: Date;
  },
): Promise<{ orders: TikTokOrder[]; nextPageToken?: string }> {
  const data = await client.request<TikTokOrderPage>({
    path: "/order/202309/orders/search",
    method: "POST",
    accessToken: input.accessToken,
    shopCipher: input.shopCipher,
    query: {
      page_size: input.pageSize ?? 100,
      ...(input.pageToken ? { page_token: input.pageToken } : {}),
    },
    body: input.updatedSince
      ? { update_time_ge: Math.floor(input.updatedSince.getTime() / 1000) }
      : {},
  });
  return { orders: data.orders ?? data.order_list ?? [], nextPageToken: data.next_page_token };
}
