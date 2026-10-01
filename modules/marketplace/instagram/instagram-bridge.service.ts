import "server-only";

import type { Connector, DeliveryAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere } from "@/lib/tenant";
import { decryptDeliverySecret } from "@/modules/delivery/core/crypto.service";
import { instagramOAuthService } from "@/modules/delivery/instagram/auth.service";
import type { NormalizedContent } from "@/modules/connectors/core/connector.interface";
import { marketplaceRepository } from "../core/connector.repository";
import { encryptConnectorSecret } from "../core/crypto.service";
import { ConnectorNotConnectedError, ProviderApiError } from "../core/errors";

/**
 * Instagram Shopping bridge (PR012) — official Graph API, server-side ONLY.
 *
 * The OAuth2 flow itself (Facebook Login → long-lived token → encrypted
 * DeliveryAccount) already ships in PR010; this bridge MIRRORS that
 * credential into the unified Connector model (re-encrypted under
 * CONNECTOR_ENCRYPTION_KEY) and serves catalog syncs through the Graph API.
 */

const PROVIDER = "INSTAGRAM" as const;

function graphMediaUrl(igAccountId: string): URL {
  const base = process.env.META_GRAPH_API_BASE_URL?.trim() || "https://graph.facebook.com";
  const version = process.env.META_GRAPH_API_VERSION?.trim() || "v21.0";
  return new URL(`${base.replace(/\/$/, "")}/${version}/${igAccountId}/media`);
}

async function findConnectedAccount(organizationId: string): Promise<DeliveryAccount | null> {
  return prisma.deliveryAccount.findFirst({
    where: scopedWhere(organizationId, {
      channel: "INSTAGRAM",
      status: "CONNECTED",
    }),
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Mirror the PR010 Instagram credential into the unified Connector row.
 * Called after a successful OAuth callback and before every sync, so the
 * card always reflects the real connection state.
 */
export async function mirrorInstagramConnection(organizationId: string): Promise<Connector | null> {
  const account = await findConnectedAccount(organizationId);
  if (!account?.encryptedAccessToken) return null;
  const accessToken = decryptDeliverySecret(account.encryptedAccessToken);
  return marketplaceRepository.upsertConnection(organizationId, PROVIDER, {
    status: "CONNECTED",
    accessToken: encryptConnectorSecret(accessToken),
    refreshToken: null,
    expiresAt: account.expiresAt,
    shopId: account.accountId,
    shopName: account.accountName,
  });
}

interface GraphMediaResponse {
  data?: Array<{
    id?: string;
    caption?: string;
    media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
    media_url?: string;
    thumbnail_url?: string;
    permalink?: string;
    timestamp?: string;
    like_count?: number;
    comments_count?: number;
  }>;
  error?: { message?: string };
}

/**
 * Fetch the Instagram Business catalog/feed, normalized onto the connector
 * framework contract (IMAGE/VIDEO items).
 */
export async function fetchInstagramContent(
  organizationId: string,
  limit: number,
): Promise<NormalizedContent[]> {
  const account = await findConnectedAccount(organizationId);
  if (!account) throw new ConnectorNotConnectedError(PROVIDER);

  // Transparent long-lived token rotation before expiry (PR010 contract).
  const accessToken = await instagramOAuthService.getValidAccessToken(organizationId, account);

  const url = graphMediaUrl(account.accountId);
  url.searchParams.set(
    "fields",
    "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
  );
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 50)));
  url.searchParams.set("access_token", accessToken);

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new ProviderApiError("Falha de rede ao contatar a Graph API.", 503, PROVIDER);
  }
  const payload = (await response.json().catch(() => undefined)) as GraphMediaResponse | undefined;
  if (!response.ok || payload?.error) {
    throw new ProviderApiError(
      "A Graph API rejeitou a consulta ao catálogo do Instagram.",
      response.status || 502,
      PROVIDER,
    );
  }

  return (payload?.data ?? [])
    .filter((media) => Boolean(media.id))
    .map((media) => ({
      externalId: `instagram:media:${account.accountId}:${media.id}`,
      type: media.media_type === "VIDEO" ? ("VIDEO" as const) : ("IMAGE" as const),
      title: media.caption?.split("\n")[0]?.slice(0, 120) || `Mídia ${media.id}`,
      url: media.permalink,
      thumbnailUrl: media.thumbnail_url ?? media.media_url,
      caption: media.caption,
      likes: media.like_count ?? 0,
      shares: media.comments_count ?? 0,
      publishedAt: media.timestamp ? new Date(media.timestamp) : undefined,
      raw: {
        provider: "instagram-shopping",
        igAccountId: account.accountId,
        mediaId: media.id,
        mediaType: media.media_type,
      },
    }));
}
