/**
 * Connector configuration service (PR016.2) — the unified ecosystem
 * redirect URI binding.
 *
 * The Mercado ecosystem applications (Mercado Livre listings and the
 * Mercado Pago financial flow) share ONE callback handler in this
 * deployment: the canonical `/api/mercadolivre/callback` route (the
 * `/api/connectors/mercadolivre/callback` path is an alias of the same
 * handler). The operator pins that address through a STATIC environment
 * variable, and this module is the single place that resolves it.
 *
 * Two variable names are accepted and mean exactly the same handler:
 *
 *   1. `MERCADOLIVRE_REDIRECT_URI` — the Mercado Livre (listings) name;
 *   2. `MERCADOPAGO_REDIRECT_URI`  — the Mercado Pago (financial flow)
 *      name, created on Render for the unified ecosystem callback.
 *
 * The resolution is PURE with respect to the request: no header, no
 * `request.url`, no proxy hint is ever consulted. Meli validates the
 * `redirect_uri` twice (on `/authorization` AND on the code→token
 * exchange) and requires the two values to be byte-identical to the URI
 * registered in the DevCenter — deriving the exchange value from inbound
 * request headers is what made the two legs diverge in production. Both
 * legs now read THIS value, so they cannot diverge by construction.
 *
 * This module is deliberately free of `server-only` (it must stay safe
 * behind the `modules/connectors/core` barrel) and takes an injectable
 * environment so tests never mutate globals.
 */

import { LOCAL_FALLBACK_BASE_URL, listRedirectBaseUrls, type AppUrlEnv } from "@/lib/app-url";

/**
 * Canonical path of the unified ecosystem callback handler. Both the
 * Mercado Livre and the Mercado Pago flows land here.
 */
export const UNIFIED_CALLBACK_PATH = "/api/mercadolivre/callback";

/**
 * The environment variables that may pin the unified redirect URI, in
 * precedence order. They point at the SAME handler — whichever is set
 * first wins, so an operator may use either name.
 */
export const UNIFIED_REDIRECT_URI_ENV_KEYS = [
  "MERCADOLIVRE_REDIRECT_URI",
  "MERCADOPAGO_REDIRECT_URI",
] as const;

export type UnifiedRedirectUriEnvKey = (typeof UNIFIED_REDIRECT_URI_ENV_KEYS)[number];

/**
 * Accepts only absolute http(s) URIs; trailing slashes are dropped so the
 * value can be copied straight from a dashboard without breaking Meli's
 * byte-identical comparison.
 */
function normalizeRedirectUri(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  return /^https?:\/\/[^/]+/i.test(trimmed) ? trimmed : "";
}

/**
 * Every redirect URI this deployment may legitimately present to the
 * Mercado ecosystem, in precedence order and de-duplicated — ALL of them
 * static (environment only):
 *
 * 1. `MERCADOLIVRE_REDIRECT_URI` / `MERCADOPAGO_REDIRECT_URI` — the
 *    operator's explicit pin of the unified callback (Render).
 * 2. `APP_URL`, then `NEXTAUTH_URL` — the deployment's configured public
 *    address plus the unified callback path.
 * 3. `http://localhost:3000` — local development only.
 *
 * Deliberately ABSENT: anything derived from the inbound request (its
 * headers, its host, its URL). See the module doc.
 */
export function listUnifiedRedirectUriCandidates(env: AppUrlEnv = process.env): string[] {
  const candidates = [
    ...UNIFIED_REDIRECT_URI_ENV_KEYS.map((key) => normalizeRedirectUri(env[key])),
    ...listRedirectBaseUrls(undefined, env).map((base) => `${base}${UNIFIED_CALLBACK_PATH}`),
    `${LOCAL_FALLBACK_BASE_URL}${UNIFIED_CALLBACK_PATH}`,
  ];
  return candidates.filter(
    (candidate, index) => candidate.length > 0 && candidates.indexOf(candidate) === index,
  );
}

/**
 * THE redirect URI of the ecosystem — the first static candidate.
 *
 * This is the single value used by BOTH the authorization URL and the
 * token exchange (`exchangeMercadoLivreCode`), and it must be registered
 * verbatim in the DevCenter of every Mercado ecosystem application.
 */
export function resolveUnifiedRedirectUri(env: AppUrlEnv = process.env): string {
  return (
    listUnifiedRedirectUriCandidates(env)[0] ?? `${LOCAL_FALLBACK_BASE_URL}${UNIFIED_CALLBACK_PATH}`
  );
}
