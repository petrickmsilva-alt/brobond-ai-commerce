import { NextResponse } from "next/server";
import {
  TIKTOK_SIGNATURE_FILE_PATH,
  TIKTOK_SITE_VERIFICATION_TOKEN,
  TIKTOK_VERIFICATION_CONTENT_TYPE,
} from "@/lib/tiktok-site-verification";

/**
 * TikTok Developers — domain ownership verification endpoint (extensionless).
 *
 * WHERE THIS SITS IN THE REDUNDANCY LADDER
 * ----------------------------------------
 * This handler is a BACKSTOP, not the primary proof. The path TikTok's
 * URL-prefix validator actually requests is
 * `/tiktok<SIGNATURE>.txt` — shipped as a real static file in `public/` (see
 * `lib/tiktok-site-verification.ts` for the full explanation of the three
 * verification methods). This route exists because the extensionless path is
 * a plausible guess, costs nothing to serve, and some tooling probes it.
 *
 * WHY A ROUTE HANDLER AND NOT A `public/` FILE AT THIS PATH
 * ---------------------------------------------------------
 * It must not be a public file. Next.js refuses to resolve a `public/` entry
 * and a route that share a path, and answers the request with a 500:
 *
 *     A conflicting public file and page file was found for path
 *     /tiktok-developers-site-verification
 *
 * That failure mode is worse than having only one of the two, because it
 * takes a working endpoint down. The `.txt` variants live in `public/`
 * precisely because no route claims those paths. Keep it that way: adding
 * `public/tiktok-developers-site-verification` (no extension) breaks this.
 *
 * A handler also lets us pin the `content-type` outright. An extensionless
 * static file would be handed to the static handler with a guessed or absent
 * type, and the validator rejects anything that is not plain text.
 *
 * THE RESPONSE CONTRACT
 * ---------------------
 *   - body: the token, byte for byte, no trailing newline, no HTML, no BOM.
 *   - `content-type: text/plain; charset=utf-8`, set explicitly.
 *   - 200 on GET and HEAD. Nothing else is exported, so Next.js answers 405
 *     for POST/PUT/DELETE automatically.
 *
 * WHY `dynamic = "force-static"`
 * ------------------------------
 * The payload is a compile-time constant. Prerendering it means the validator
 * is served without waking a server instance, and the response can never fail
 * because of a cold database or a missing env var. This is deliberately the
 * opposite choice from the `/api/*` handlers, which are `force-dynamic`
 * because they read a session.
 *
 * MIDDLEWARE
 * ----------
 * Every verification path is registered in `PUBLIC_PREFIXES`
 * (`lib/auth-routes.ts`), so `proxy.ts` short-circuits before attempting any
 * JWT work. TikTok's crawler carries no session cookie and this must answer
 * 200 to an anonymous request forever.
 */

export const runtime = "nodejs";
export const dynamic = "force-static";

/**
 * Shared headers. `Link: rel="canonical"` points at the signature file that
 * TikTok actually fetches, so anyone who lands here while debugging a failed
 * verification is pushed towards the path that matters.
 */
const VERIFICATION_HEADERS: Readonly<Record<string, string>> = {
  "content-type": TIKTOK_VERIFICATION_CONTENT_TYPE,
  // The token is public by design (it is meant to be fetched by a third
  // party) and immutable until it is rotated in the console, so a long cache
  // is safe and keeps repeat verifications off the origin.
  "cache-control": "public, max-age=3600, s-maxage=86400",
  // Nothing here should ever be sniffed into another type.
  "x-content-type-options": "nosniff",
  link: `<${TIKTOK_SIGNATURE_FILE_PATH}>; rel="canonical"`,
};

export function GET(): NextResponse {
  return new NextResponse(TIKTOK_SITE_VERIFICATION_TOKEN, {
    status: 200,
    headers: VERIFICATION_HEADERS,
  });
}

/**
 * Some validators probe with HEAD before GET. Next.js can derive HEAD from
 * GET, but only when GET is statically renderable — exporting it explicitly
 * removes the ambiguity and keeps the headers identical.
 */
export function HEAD(): NextResponse {
  return new NextResponse(null, {
    status: 200,
    headers: VERIFICATION_HEADERS,
  });
}
