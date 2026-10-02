/** TikTok Shop Connector (PR009) — official API only, server-side. */
export { TikTokConnector, TikTokConnectionRequiredError } from "./tiktok.connector";
export {
  TikTokPendingApprovalError,
  TIKTOK_PENDING_APPROVAL_MESSAGE,
} from "./pending-approval.service";
export {
  connectTikTok,
  exchangeCode,
  refreshAccessToken,
  revokeConnection,
} from "./auth/oauth.service";
