import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import { GET, HEAD } from "@/app/tiktok-developers-site-verification/route";
import { PUBLIC_PREFIXES, isPublicRoute, isProtectedRoute } from "@/lib/auth-routes";
import {
  TIKTOK_SIGNATURE_FILE_PATH,
  TIKTOK_SITE_VERIFICATION_META_NAME,
  TIKTOK_SITE_VERIFICATION_PATH,
  TIKTOK_SITE_VERIFICATION_SIGNATURE,
  TIKTOK_SITE_VERIFICATION_TOKEN,
  TIKTOK_SITE_VERIFICATION_TXT_PATH,
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

  it("points the signature file at the path TikTok's URL-prefix validator fetches", () => {
    // TikTok issues a file named `tiktok<SIGNATURE>.txt`, NOT a file named
    // after the `tiktok-developers-site-verification` key. Getting this wrong
    // is what produced the original "signature not found" rejection.
    expect(TIKTOK_SIGNATURE_FILE_PATH).toBe(`/tiktok${EXPECTED_SIGNATURE}.txt`);
  });

  it("uses the bare signature for the meta tag, not the full token", () => {
    expect(TIKTOK_SITE_VERIFICATION_META_NAME).toBe("tiktok-developers-site-verification");
    expect(TIKTOK_SITE_VERIFICATION_SIGNATURE).not.toContain("=");
  });
});

describe("static signature files in public/", () => {
  const staticPaths = [TIKTOK_SIGNATURE_FILE_PATH, TIKTOK_SITE_VERIFICATION_TXT_PATH];

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

  it("covers all three serving strategies", () => {
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_SIGNATURE_FILE_PATH);
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_SITE_VERIFICATION_PATH);
    expect(TIKTOK_VERIFICATION_PATHS).toContain(TIKTOK_SITE_VERIFICATION_TXT_PATH);
  });
});
