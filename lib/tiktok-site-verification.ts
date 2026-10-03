/**
 * TikTok Developers — domain / URL-property ownership constants.
 *
 * PURE MODULE. Imports nothing at all, so it is safe in all three runtimes the
 * app uses: the Edge proxy (`proxy.ts`), Node server components and route
 * handlers, and plain Vitest.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * TikTok's downloaded proof has TWO byte-exact values: its filename and the
 * signature in its body. They happen to contain the same opaque value for the
 * current root-prefix proof, but that is not an API contract and they must not
 * be reconstructed from one another. A newly requested property can issue a
 * different file and signature. `tests/tiktok-site-verification.test.ts` pins
 * the checked-in artifact against both independent constants so a rename,
 * token rotation or stale copy fails CI.
 *
 * HOW TIKTOK ACTUALLY VERIFIES A URL
 * ----------------------------------
 * The TikTok Developers console offers three proofs, and they do NOT share a
 * URL. This matters, because the first attempt at this feature served the
 * token at `/tiktok-developers-site-verification` — a path TikTok never
 * requests — and the validator reported "signature not found".
 *
 *   1. URL prefix (signature file). The console hands you a file to download
 *      and fetches that EXACT filename from the URL prefix you entered. For
 *      the selected root prefix (`https://<host>/`) the current artifact is:
 *
 *          https://<host>/tiktok2curKlcJu06uY8EYHsELz6YWP3VFqLLZ.txt
 *
 *      THIS IS THE PATH THE VALIDATOR HITS. Do not invent the filename from
 *      the body token: on rotation, copy the newly downloaded filename and
 *      body verbatim. It is served as a real static file from `public/`.
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
 * The exact filename downloaded from the root URL-prefix verification dialog.
 *
 * Keep this independent from `TIKTOK_SITE_VERIFICATION_SIGNATURE`. TikTok owns
 * both values; even when they look related, deriving one instead of preserving
 * the downloaded artifact can make the crawler request a path that does not
 * exist and produce the misleading "verification signature not found" error.
 */
export const TIKTOK_SIGNATURE_FILE_NAME = "tiktok2curKlcJu06uY8EYHsELz6YWP3VFqLLZ.txt";

/**
 * Canonical root-prefix signature path.
 *
 * Shipped as a real file in `public/` so it is served by the static handler
 * with `content-type: text/plain` derived from the `.txt` extension, with no
 * server render and no dependency on the database or any env var.
 */
export const TIKTOK_SIGNATURE_FILE_PATH = `/${TIKTOK_SIGNATURE_FILE_NAME}`;

/**
 * The single URL prefix operators must register in Production.
 *
 * `https://<host>/` owns every URL below it on the same host, including the
 * Terms and Privacy pages. Starting a second verification for either legal
 * page generates a new challenge; copying this root challenge into that path
 * does not turn it into the new challenge.
 */
export const TIKTOK_CANONICAL_URL_PREFIX = "/";

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
 * Compatibility aliases from earlier failed attempts.
 *
 * These make the existing artifact reachable under the historical `/Request/`
 * prefix, but they are NOT a substitute for the exact file downloaded for a
 * newly created `/Request/` property challenge. The supported flow verifies
 * only the root prefix declared above.
 */
export const TIKTOK_REQUEST_PREFIX = "/Request";
export const TIKTOK_REQUEST_SIGNATURE_FILE_PATH = `${TIKTOK_REQUEST_PREFIX}${TIKTOK_SIGNATURE_FILE_PATH}`;
export const TIKTOK_REQUEST_VERIFICATION_TXT_PATH = `${TIKTOK_REQUEST_PREFIX}${TIKTOK_SITE_VERIFICATION_TXT_PATH}`;

/**
 * Compatibility aliases from the `/terms-of-service/` retry.
 *
 * The previous implementation incorrectly described a copy of the root proof
 * as sufficient for a new Terms-prefix challenge. TikTok validates the exact
 * downloaded artifact for the property being created. These paths remain live
 * so old probes do not regress, but the reliable solution is to verify the
 * root prefix once; it already owns `/terms-of-service/` and
 * `/privacy-policy/` on the same host.
 */
export const TIKTOK_TERMS_PREFIX = "/terms-of-service";
export const TIKTOK_TERMS_SIGNATURE_FILE_PATH = `${TIKTOK_TERMS_PREFIX}${TIKTOK_SIGNATURE_FILE_PATH}`;
export const TIKTOK_TERMS_VERIFICATION_TXT_PATH = `${TIKTOK_TERMS_PREFIX}${TIKTOK_SITE_VERIFICATION_TXT_PATH}`;

/**
 * Every path that must answer `200 text/plain` with the token, anonymously
 * and forever. Consumed by `lib/auth-routes.ts` to exempt them from the auth
 * proxy, and by the test suite to assert each one is actually reachable.
 */
export const TIKTOK_VERIFICATION_PATHS: readonly string[] = [
  TIKTOK_SIGNATURE_FILE_PATH,
  TIKTOK_SITE_VERIFICATION_PATH,
  TIKTOK_SITE_VERIFICATION_TXT_PATH,
  TIKTOK_REQUEST_SIGNATURE_FILE_PATH,
  TIKTOK_REQUEST_VERIFICATION_TXT_PATH,
  TIKTOK_TERMS_SIGNATURE_FILE_PATH,
  TIKTOK_TERMS_VERIFICATION_TXT_PATH,
] as const;

/** Pinned so the validator never has to negotiate or guess the encoding. */
export const TIKTOK_VERIFICATION_CONTENT_TYPE = "text/plain; charset=utf-8";
