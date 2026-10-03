/**
 * TikTok Developers — domain / URL-property ownership constants.
 *
 * PURE MODULE. Imports nothing at all, so it is safe in all three runtimes the
 * app uses: the Edge proxy (`proxy.ts`), Node server components and route
 * handlers, and plain Vitest.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The same 32-character signature has to appear in five unrelated places (a
 * route handler body, two static files, a `<meta>` tag and a DNS TXT record).
 * Before this module the literal was pasted into each of them, which is how a
 * verification silently rots: someone rotates the token in one spot and the
 * other four keep serving the old one. Everything derives from
 * `TIKTOK_SITE_VERIFICATION_SIGNATURE` below — rotate it there and the whole
 * surface moves together. `tests/tiktok-site-verification.test.ts` pins the
 * static files against these constants so a drifting copy fails CI.
 *
 * HOW TIKTOK ACTUALLY VERIFIES A URL
 * ----------------------------------
 * The TikTok Developers console offers three proofs, and they do NOT share a
 * URL. This matters, because the first attempt at this feature served the
 * token at `/tiktok-developers-site-verification` — a path TikTok never
 * requests — and the validator reported "signature not found".
 *
 *   1. URL prefix (signature file). The console hands you a file to download
 *      named `tiktok<SIGNATURE>.txt` and fetches it from the root of the URL
 *      prefix you entered:
 *
 *          https://<host>/tiktok2curKlcJu06uY8EYHsELz6YWP3VFqLLZ.txt
 *
 *      THIS IS THE PATH THE VALIDATOR HITS. It is `TIKTOK_SIGNATURE_FILE_PATH`
 *      and it is served as a real static file from `public/`.
 *
 *   2. Domain (DNS). A TXT record on the apex whose value is the full
 *      `name=signature` token — `TIKTOK_SITE_VERIFICATION_TOKEN`. Nothing in
 *      this repository can satisfy that one; it is done at the registrar.
 *
 *   3. Meta tag. `<meta name="tiktok-developers-site-verification"
 *      content="<SIGNATURE>">` in the `<head>` of the homepage. Note that the
 *      `content` is the BARE SIGNATURE, not the `name=value` token — see
 *      `TIKTOK_SITE_VERIFICATION_META_NAME` below.
 *
 * We ship 1 and 3, plus two extra plain-text paths, because re-verification is
 * asynchronous and a failed review costs days.
 */

/**
 * The opaque 32-character signature issued by the TikTok Developers console.
 *
 * This is public by design — it exists to be fetched by a third party — so it
 * is a source-controlled constant rather than an env var. Rotating it in the
 * console means changing it here and renaming the file in `public/`.
 */
export const TIKTOK_SITE_VERIFICATION_SIGNATURE = "2curKlcJu06uY8EYHsELz6YWP3VFqLLZ";

/**
 * The full token, in the `name=value` shape TikTok writes into the signature
 * file and into the DNS TXT record.
 *
 * Byte-exact: no surrounding whitespace, no trailing newline, no BOM.
 */
export const TIKTOK_SITE_VERIFICATION_TOKEN = `tiktok-developers-site-verification=${TIKTOK_SITE_VERIFICATION_SIGNATURE}`;

/**
 * `<meta name="...">` attribute for the homepage meta-tag proof.
 *
 * The tag's `content` is `TIKTOK_SITE_VERIFICATION_SIGNATURE` on its own —
 * putting the full `name=value` token in there is the single most common way
 * to fail the meta-tag check, because the validator compares `content`
 * against the raw signature.
 */
export const TIKTOK_SITE_VERIFICATION_META_NAME = "tiktok-developers-site-verification";

/**
 * The canonical URL-prefix signature file: `/tiktok<SIGNATURE>.txt`.
 *
 * Shipped as a real file in `public/` so it is served by the static handler
 * with `content-type: text/plain` derived from the `.txt` extension, with no
 * server render and no dependency on the database or any env var.
 */
export const TIKTOK_SIGNATURE_FILE_PATH = `/tiktok${TIKTOK_SITE_VERIFICATION_SIGNATURE}.txt`;

/**
 * Extensionless path, served by the App Router handler at
 * `app/tiktok-developers-site-verification/route.ts`.
 *
 * IMPORTANT: there must be NO file of this name in `public/`. Next.js refuses
 * to resolve a public file and a route that share a path and answers the
 * request with a 500 ("A conflicting public file and page file was found"),
 * which would take the endpoint down rather than make it redundant.
 */
export const TIKTOK_SITE_VERIFICATION_PATH = "/tiktok-developers-site-verification";

/** `.txt` sibling of the above, shipped as a static file in `public/`. */
export const TIKTOK_SITE_VERIFICATION_TXT_PATH = `${TIKTOK_SITE_VERIFICATION_PATH}.txt`;

/**
 * Every path that must answer `200 text/plain` with the token, anonymously
 * and forever. Consumed by `lib/auth-routes.ts` to exempt them from the auth
 * proxy, and by the test suite to assert each one is actually reachable.
 */
export const TIKTOK_VERIFICATION_PATHS: readonly string[] = [
  TIKTOK_SIGNATURE_FILE_PATH,
  TIKTOK_SITE_VERIFICATION_PATH,
  TIKTOK_SITE_VERIFICATION_TXT_PATH,
] as const;

/** Pinned so the validator never has to negotiate or guess the encoding. */
export const TIKTOK_VERIFICATION_CONTENT_TYPE = "text/plain; charset=utf-8";
