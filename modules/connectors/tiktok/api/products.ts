import type { TikTokApiClient } from "./client";

export interface TikTokProduct {
  id?: string;
  product_id?: string;
  title?: string;
  name?: string;
  description?: string;
  status?: string;
  images?: { urls?: string[]; url?: string }[];
  main_images?: { urls?: string[]; url?: string }[];
  skus?: TikTokProductSku[];
  [key: string]: unknown;
}

export interface TikTokProductSku {
  id?: string;
  sku_id?: string;
  seller_sku?: string;
  sku_code?: string;
  price?: Record<string, unknown> | string | number;
  sales_price?: string | number;
  currency?: string;
  stock_info?: { available_stock?: number };
  [key: string]: unknown;
}

interface TikTokProductPage {
  products?: TikTokProduct[];
  product_list?: TikTokProduct[];
  next_page_token?: string;
}

/** Official Product API v202502: POST /product/202502/products/search. */
export async function getProducts(
  client: TikTokApiClient,
  input: { accessToken: string; shopCipher: string; pageSize?: number; pageToken?: string },
): Promise<{ products: TikTokProduct[]; nextPageToken?: string }> {
  const data = await client.request<TikTokProductPage>({
    path: "/product/202502/products/search",
    method: "POST",
    accessToken: input.accessToken,
    shopCipher: input.shopCipher,
    query: {
      page_size: input.pageSize ?? 100,
      ...(input.pageToken ? { page_token: input.pageToken } : {}),
    },
    body: {},
  });
  return {
    products: data.products ?? data.product_list ?? [],
    nextPageToken: data.next_page_token,
  };
}
