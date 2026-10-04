import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import {
  GET,
  HEAD,
  dynamic as verificationRouteMode,
} from "@/app/tiktok-developers-site-verification/route";
import nextConfig from "@/next.config";
import { PUBLIC_PREFIXES, isPublicRoute, isProtectedRoute } from "@/lib/auth-routes";
import {
  TIKTOK_CANONICAL_URL_PREFIX,
  TIKTOK_REQUEST_SIGNATURE_FILE_PATH,
  TIKTOK_REQUEST_VERIFICATION_TXT_PATH,
  TIKTOK_SIGNATURE_FILE_NAME,
  TIKTOK_SIGNATURE_FILE_PATH,
  TIKTOK_SITE_VERIFICATION_META_NAME,
  TIKTOK_SITE_VERIFICATION_PATH,
  TIKTOK_SITE_VERIFICATION_SIGNATURE,
  TIKTOK_SITE_VERIFICATION_TOKEN,
  TIKTOK_SITE_VERIFICATION_TXT_PATH,
  TIKTOK_TERMS_SIGNATURE_FILE_PATH,
  TIKTOK_TERMS_VERIFICATION_TXT_PATH,
  TIKTOK_VERIFICATION_PATHS,
} from "@/lib/tiktok-site-verification";

/**
 * Contract tests for the TikTok domain-ownership surface.
 *
 * This feature is validated by a third party we cannot re-run on demand: if
 * the body gains a trailing newline, the content type drifts to `text/html`,
 * or the signature file is renamed, TikTok rejects the domain and the only
 * signal is a failed review days later. These assertions are byte-exact on
 * purpose.
 */

const PUBLIC_DIR = join(process.cwd(), "public");
const APP_DIR = join(process.cwd(), "app");

/** Hard-coded on purpose: a literal the constants module cannot "fix" for us. */
const EXPECTED_TOKEN = "tiktok-developers-site-verification=2curKlcJu06uY8EYHsELz6YWP3VFqLLZ";
const EXPECTED_SIGNATURE = "2curKlcJu06uY8EYHsELz6YWP3VFqLLZ";

describe("verification constants", () => {
  it("derives the token from the signature, byte for byte", () => {
    expect(TIKTOK_SITE_VERIFICATION_SIGNATURE).toBe(EXPECTED_SIGNATURE);
    expect(TIKTOK_SITE_VERIFICATION_TOKEN).toBe(EXPECTED_TOKEN);
  });

  it("preserves the exact downloaded filename instead of reconstructing it", () => {
    // Filename and body are independent values owned by TikTok. Pinning both
    // literals prevents another guessed filename from reaching production.
    expect(TIKTOK_SIGNATURE_FILE_NAME).toBe("tiktok2curKlcJu06uY8EYHsELz6YWP3VFqLLZ.txt");
    expect(TIKTOK_SIGNATURE_FILE_PATH).toBe(`/${TIKTOK_SIGNATURE_FILE_NAME}`);
  });

  it("uses the root URL prefix so one property owns all same-host app URLs", () => {
    expect(TIKTOK_CANONICAL_URL_PREFIX).toBe("/");
  });

  it("uses the bare signature for the meta tag, not the full token", () => {
    expect(TIKTOK_SITE_VERIFICATION_META_NAME).toBe("tiktok-developers-site-verification");
    expect(TIKTOK_SITE_VERIFICATION_SIGNATURE).not.toContain("=");
  });
});

describe("static signature files in public/", () => {
  const staticPaths = [
    TIKTOK_SIGNATURE_FILE_PATH,
    TIKTOK_SITE_VERIFICATION_TXT_PATH,
    TIKTOK_REQUEST_SIGNATURE_FILE_PATH,
    TIKTOK_REQUEST_VERIFICATION_TXT_PATH,
    TIKTOK_TERMS_SIGNATURE_FILE_PATH,
    TIKTOK_TERMS_VERIFICATION_TXT_PATH,
  ];

  it.each(staticPaths)("%s exists on disk", (path) => {
    expect(existsSync(join(PUBLIC_DIR, path))).toBe(true);
  });

  it.each(staticPaths)("%s contains exactly the token and nothing else", (path) => {
    const raw = readFileSync(join(PUBLIC_DIR, path), "utf8");
    expect(raw).toBe(EXPECTED_TOKEN);
  });

  it.each(staticPaths)("%s has no trailing newline, whitespace or BOM", (path) => {
    const buffer = readFileSync(join(PUBLIC_DIR, path));
    // 68 ASCII bytes. A BOM would add 3, a trailing "\n" would add 1.
    expect(buffer.byteLength).toBe(Buffer.byteLength(EXPECTED_TOKEN, "utf8"));
    expect(buffer[0]).not.toBe(0xef); // UTF-8 BOM lead byte
    expect(buffer.toString("utf8")).not.toMatch(/[\r\n]/);
  });
});

/**
 * REGRESSION GUARD — the failure that motivated this test file.
 *
 * Next.js refuses to resolve a `public/` entry and an App Router route that
 * claim the same path, and answers 500 with "A conflicting public file and
 * page file was found". Shipping both `public/tiktok-developers-site-verification`
 * and `app/tiktok-developers-site-verification/route.ts` therefore does not
 * produce redundancy — it takes the endpoint down. This test fails the build
 * before that reaches production.
 */
describe("no public file shadows an App Router route", () => {
  it("has no extensionless public/tiktok-developers-site-verification", () => {
    expect(existsSync(join(PUBLIC_DIR, "tiktok-developers-site-verification"))).toBe(false);
  });

  it("has no public file colliding with any app route segment", () => {
    const appSegments = new Set(
      readdirSync(APP_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("("))
        .map((entry) => entry.name),
    );
    const collisions = readdirSync(PUBLIC_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && appSegments.has(entry.name))
      .map((entry) => entry.name);

    expect(collisions).toEqual([]);
  });
});

describe("GET /tiktok-developers-site-verification", () => {
  it("returns 200", () => {
    expect(GET().status).toBe(200);
  });

  it("returns the verification token byte for byte", async () => {
    expect(await GET().text()).toBe(EXPECTED_TOKEN);
  });

  it("has no leading/trailing whitespace, newline or BOM", async () => {
    const body = await GET().text();
    expect(body).toBe(body.trim());
    expect(body).not.toMatch(/[\r\n]/);
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("contains no HTML", async () => {
    expect(await GET().text()).not.toMatch(/[<>]/);
  });

  it("declares text/plain; charset=utf-8 explicitly", () => {
    expect(GET().headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("forbids content-type sniffing", () => {
    expect(GET().headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers HEAD with the same status and content type", () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });
});

describe("homepage meta-tag proof", () => {
  /** `verification.other` is what Next.js renders into `<head>`. */
  function verificationOther(): Record<string, string | number | (string | number)[]> {
    const other = metadata.verification?.other;
    if (!other) throw new Error("Root metadata.verification.other is not set");
    return other;
  }

  it("declares the tiktok-developers-site-verification meta tag", () => {
    expect(Object.keys(verificationOther())).toContain(TIKTOK_SITE_VERIFICATION_META_NAME);
  });

  it("carries the BARE signature as content, not the full name=value token", () => {
    const content = verificationOther()[TIKTOK_SITE_VERIFICATION_META_NAME];
    expect(content).toBe(EXPECTED_SIGNATURE);
    // The usual way this check fails: pasting the whole token into `content`.
    expect(content).not.toBe(EXPECTED_TOKEN);
    expect(String(content)).not.toContain("=");
  });
});

describe("URL-property reachability", () => {
  it("does not 308-redirect TikTok's required trailing-slash prefixes", () => {
    expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
  });

  it("keeps the extensionless fallback out of the production prerender pass", () => {
    expect(verificationRouteMode).toBe("force-dynamic");
  });

  it.each(["api/connectors/tiktok/callback/route.ts", "api/tiktok/callback/route.ts"])(
    "keeps %s dynamic during production route collection",
    (routePath) => {
      const source = readFileSync(join(APP_DIR, routePath), "utf8");
      expect(source).toContain('export const dynamic = "force-dynamic"');
    },
  );

  it("links the exact configured legal URLs directly from the public homepage", () => {
    const landingPage = readFileSync(join(APP_DIR, "page.tsx"), "utf8");
    expect(landingPage).toContain('href="/terms-of-service/"');
    expect(landingPage).toContain('href="/privacy-policy/"');
    expect(landingPage).not.toContain('href="/terms"');
    expect(landingPage).not.toContain('href="/privacy"');
  });
});

describe("middleware posture for the verification surface", () => {
  it.each(TIKTOK_VERIFICATION_PATHS)(
    "%s bypasses the auth proxy — TikTok's crawler carries no session cookie",
    (path) => {
      expect(isPublicRoute(path)).toBe(true);
      expect(PUBLIC_PREFIXES).toContain(path);
    },
  );

  it.each(TIKTOK_VERIFICATION_PATHS)("%s is never treated as a protected route", (path) => {
    expect(isProtectedRoute(path)).toBe(false);
  });

  it("covers root, /Request and /terms-of-service URL-prefix properties", () => {
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_SIGNATURE_FILE_PATH);
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_SITE_VERIFICATION_PATH);
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_SITE_VERIFICATION_TXT_PATH);
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_REQUEST_SIGNATURE_FILE_PATH);
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_REQUEST_VERIFICATION_TXT_PATH);
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_TERMS_SIGNATURE_FILE_PATH);
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_TERMS_VERIFICATION_TXT_PATH);
  });
});
