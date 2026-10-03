import { NextResponse } from "next/server";

/**
 * TikTok Developers — domain ownership verification endpoint.
 *
 * WHY A ROUTE HANDLER AND NOT A STATIC FILE
 * -----------------------------------------
 * TikTok's validator fetches `https://<domain>/tiktok-developers-site-verification`
 * — a path with NO file extension. Serving that from `public/` is unreliable:
 * the file would have to be named without an extension, and Next.js would hand
 * it to the static handler with a guessed (or missing) `content-type`. The
 * validator rejects anything that is not plain text, so the content type is
 * part of the contract, not a detail. A route handler lets us pin both the
 * exact body and the exact header.
 *
 * THE RESPONSE CONTRACT
 * ---------------------
 *   - body: the verification string, byte for byte, with no trailing newline,
 *     no surrounding HTML and no BOM. `String.raw`-free plain literal below.
 *   - `content-type: text/plain; charset=utf-8` — set explicitly rather than
 *     left to the framework's inference.
 *   - status 200 on GET and HEAD. Nothing else is exported, so Next.js answers
 *     405 for POST/PUT/DELETE automatically.
 *
 * WHY `force-static` + `dynamic = "force-static"`
 * -----------------------------------------------
 * The payload is a constant. Rendering it statically means the validator (and
 * any later re-verification TikTok runs) is served from the edge cache without
 * waking a server instance, and it can never fail because of a cold database
 * or a missing env var. This is deliberately the opposite choice from the
 * `/api/*` handlers in this codebase, which are `force-dynamic` because they
 * read a session.
 *
 * MIDDLEWARE
 * ----------
 * `/tiktok-developers-site-verification` is registered in `PUBLIC_PREFIXES`
 * (`lib/auth-routes.ts`) so `proxy.ts` short-circuits before attempting any
 * JWT work. TikTok's crawler carries no session cookie, and this route must
 * answer 200 to an anonymous request forever.
 */

/** The token issued by the TikTok Developers console. Treated as an opaque constant. */
const TIKTOK_SITE_VERIFICATION =
  "tiktok-developers-site-verification=2curKlcJu06uY8EYHsELz6YWP3VFqLLZ";

/** Pinned so the validator never has to negotiate or guess the encoding. */
const PLAIN_TEXT_UTF8 = "text/plain; charset=utf-8";

export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET(): NextResponse {
  return new NextResponse(TIKTOK_SITE_VERIFICATION, {
    status: 200,
    headers: {
      "content-type": PLAIN_TEXT_UTF8,
      // The token is public by design (it is meant to be fetched by a third
      // party) and immutable until the director rotates it, so a long cache is
      // safe and keeps repeat verifications off the origin.
      "cache-control": "public, max-age=3600, s-maxage=86400",
      // Nothing here should ever be sniffed into another type.
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Some validators probe with HEAD before GET. Next.js can derive HEAD from GET,
 * but only when GET is statically renderable — exporting it explicitly removes
 * the ambiguity and keeps the headers identical.
 */
export function HEAD(): NextResponse {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "content-type": PLAIN_TEXT_UTF8,
      "cache-control": "public, max-age=3600, s-maxage=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
