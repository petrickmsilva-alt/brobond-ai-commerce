import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import {
  CONNECTOR_PROVIDERS,
  CONNECTOR_PROVIDER_LABELS,
} from "@/modules/marketplace/core/providers";

/**
 * Browser-tab brand signature.
 *
 * Every internal screen must read "<página> | Brobond Wear" in the tab, and
 * the segments that declare no title of their own must fall back to the
 * branded default. That is delivered by a SINGLE declaration — `title.template`
 * in the root layout — instead of each page repeating the brand by hand.
 *
 * These tests pin the three ways that contract can silently regress:
 *   1. the template/default strings drift;
 *   2. a page opts out with `title: { absolute: … }`, shipping a bare,
 *      unbranded tab;
 *   3. a page hardcodes the brand in its own title, which the template would
 *      then append a second time ("… | Brobond Wear | Brobond Wear").
 */

const BRAND = "Brobond Wear";
const TEMPLATE = `%s | ${BRAND}`;
const DEFAULT_TITLE = `${BRAND} — Hub Multicanal`;

const APP_DIR = path.resolve(__dirname, "..", "app");

/** Narrowed accessor: the root title is an object, never a bare string. */
function rootTitle(): { template: string; default: string } {
  const title = metadata.title;
  if (typeof title !== "object" || title === null || !("template" in title)) {
    throw new Error("Root metadata.title must be a { default, template } object");
  }
  return title as { template: string; default: string };
}

/** Resolve a tab title the way Next.js applies an inherited `title.template`. */
function resolveTab(pageTitle: string | null): string {
  const { template, default: fallback } = rootTitle();
  return pageTitle === null ? fallback : template.replace("%s", pageTitle);
}

/** Every `page.tsx` under `app/`, recursively. */
function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

/**
 * Slice out only the metadata declarations of a page source, so the scan
 * never trips over unrelated `title:` keys in page content (feature cards,
 * chart configs, …).
 */
function metadataSource(source: string): string {
  const blocks: string[] = [];

  const constStart = source.indexOf("export const metadata");
  if (constStart !== -1) {
    const end = source.indexOf("\n};", constStart);
    blocks.push(source.slice(constStart, end === -1 ? source.length : end + 3));
  }

  const fnStart = source.search(/export (?:async )?function generateMetadata/);
  if (fnStart !== -1) {
    const end = source.indexOf("\n}", fnStart);
    blocks.push(source.slice(fnStart, end === -1 ? source.length : end + 2));
  }

  return blocks.join("\n");
}

describe("root metadata — title template", () => {
  it("declares the branded template and default", () => {
    expect(rootTitle()).toEqual({ template: TEMPLATE, default: DEFAULT_TITLE });
  });

  it("uses exactly one interpolation slot, with the brand as the suffix", () => {
    const { template } = rootTitle();
    expect(template.match(/%s/g)).toHaveLength(1);
    expect(template.endsWith(BRAND)).toBe(true);
  });

  it("brands a page that declares its own title", () => {
    expect(resolveTab("Conectores")).toBe("Conectores | Brobond Wear");
    expect(resolveTab("Dashboard")).toBe("Dashboard | Brobond Wear");
  });

  it("falls back to the branded default when a segment declares no title", () => {
    expect(resolveTab(null)).toBe("Brobond Wear — Hub Multicanal");
  });

  it("brands every connector detail route, TikTok and Mercado Livre included", () => {
    for (const provider of CONNECTOR_PROVIDERS) {
      // Mirrors `generateMetadata` in app/dashboard/connectors/[provider]/page.tsx.
      const pageTitle = `${CONNECTOR_PROVIDER_LABELS[provider]} — Conectores`;
      expect(resolveTab(pageTitle)).toBe(`${pageTitle} | ${BRAND}`);
    }

    expect(resolveTab("TikTok Shop — Conectores")).toBe("TikTok Shop — Conectores | Brobond Wear");
    expect(resolveTab("Mercado Livre — Conectores")).toBe(
      "Mercado Livre — Conectores | Brobond Wear",
    );
  });
});

describe("page metadata — no route escapes the brand", () => {
  const pages = pageFiles(APP_DIR).map((file) => ({
    route: path.relative(APP_DIR, file),
    source: metadataSource(readFileSync(file, "utf8")),
  }));

  it("finds the application pages to scan", () => {
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.some((page) => page.route.includes("connectors"))).toBe(true);
  });

  it("never uses an absolute title, which would bypass the template", () => {
    for (const { route, source } of pages) {
      expect(`${route}: ${source.includes("absolute:")}`).toBe(`${route}: false`);
    }
  });

  it("never hardcodes the brand in a page title, which would duplicate it", () => {
    for (const { route, source } of pages) {
      expect(`${route}: ${source.includes("Brobond")}`).toBe(`${route}: false`);
    }
  });
});
