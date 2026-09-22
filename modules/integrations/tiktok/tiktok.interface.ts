/**
 * TikTok integration — INTERFACE ONLY (reserved for PR002 / PR004).
 *
 * PR000 deliberately does NOT implement the TikTok API, OAuth, scraping,
 * or any network calls. This file defines the contract so downstream code
 * can be architected against a stable surface.
 */

export interface TikTokCreatorProfile {
  externalId: string;
  handle: string;
  displayName: string;
  followers: number;
  avatarUrl?: string;
}

export interface TikTokClient {
  /** Exchange an OAuth code for tokens. NOT IMPLEMENTED in PR000. */
  authenticate(code: string): Promise<{ accessToken: string; refreshToken: string }>;
  /** Fetch a creator profile by handle. NOT IMPLEMENTED in PR000. */
  getCreatorProfile(handle: string): Promise<TikTokCreatorProfile>;
}

const NOT_IMPLEMENTED =
  "TikTok integration is not implemented in PR000 (reserved for PR002/PR004).";

/**
 * Placeholder client. Every method throws until a future PR provides a
 * real implementation. Kept as a factory so DI wiring is ready.
 */
export function createTikTokClient(): TikTokClient {
  return {
    authenticate() {
      throw new Error(NOT_IMPLEMENTED);
    },
    getCreatorProfile() {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
