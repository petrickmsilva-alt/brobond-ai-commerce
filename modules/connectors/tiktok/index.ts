/** TikTok Shop Connector (PR009) — official API only, server-side. */
export { TikTokConnector, TikTokConnectionRequiredError } from "./tiktok.connector";
export {
  connectTikTok,
  exchangeCode,
  refreshAccessToken,
  revokeConnection,
} from "./auth/oauth.service";
