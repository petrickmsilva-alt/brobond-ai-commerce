import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PR010.2 §8 — error boundaries ("remover erro branco").
 *
 * This repository runs Vitest in a `node` environment with no DOM library, so
 * these are contract tests over the source itself — the same static-analysis
 * approach `tests/delivery-tenant.test.ts` uses for its server-only guards.
 * They are not a substitute for rendering, but they lock the properties that
 * actually regress: a boundary file going missing, the `"use client"` pragma
 * being dropped, a required button disappearing, `global-error` acquiring an
 * import it cannot resolve, or `error.message` leaking into production.
 */

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const DASHBOARD_ERROR = "app/dashboard/error.tsx";
const ROOT_ERROR = "app/error.tsx";
const GLOBAL_ERROR = "app/global-error.tsx";
const ERROR_STATE = "components/ui/error-state.tsx";

describe("the boundaries exist", () => {
  it.each([DASHBOARD_ERROR, ROOT_ERROR, GLOBAL_ERROR, ERROR_STATE])("%s is present", (file) => {
    expect(existsSync(join(ROOT, file))).toBe(true);
  });

  it("every boundary is a Client Component", () => {
    for (const file of [DASHBOARD_ERROR, ROOT_ERROR, GLOBAL_ERROR, ERROR_STATE]) {
      // React error boundaries only work on the client; without this pragma
      // Next.js fails the build at best and silently no-ops at worst.
      expect(read(file).startsWith('"use client"'), file).toBe(true);
    }
  });

  it("every boundary default-exports a component taking { error, reset }", () => {
    for (const file of [DASHBOARD_ERROR, ROOT_ERROR, GLOBAL_ERROR]) {
      const source = read(file);
      expect(source, file).toMatch(/export default function/);
      expect(source, file).toContain("error");
      expect(source, file).toContain("reset");
      expect(source, file).toMatch(/digest\?: string/);
    }
  });
});

describe("§8 required affordances", () => {
  const source = read(ERROR_STATE);

  it('offers "Voltar ao Dashboard"', () => {
    expect(source).toContain("Voltar ao Dashboard");
  });

  it('offers "Recarregar"', () => {
    expect(source).toContain("Recarregar");
  });

  it('offers "Copiar ID"', () => {
    expect(source).toContain("Copiar ID");
  });

  it("copies the digest to the clipboard", () => {
    expect(source).toContain("navigator.clipboard.writeText");
    expect(source).toMatch(/incidentId\s*=\s*error\.digest/);
  });

  it("survives a blocked clipboard instead of throwing", () => {
    expect(source).toMatch(/catch\s*{/);
  });

  it("prefers reset() and only falls back to a full reload", () => {
    // reset() re-renders the segment in place; a reload loses scroll and shell.
    expect(source).toMatch(/reset\s*\?\s*reset\(\)\s*:\s*window\.location\.reload\(\)/);
  });

  it("renders the digest as selectable text for users who cannot copy", () => {
    expect(source).toContain("select-all");
  });

  it("announces the copy confirmation to assistive tech", () => {
    expect(source).toContain('aria-live="polite"');
  });

  it("hides the decorative icon from screen readers", () => {
    expect(source).toContain("aria-hidden");
  });
});

describe("no information leak", () => {
  it("shows error.message ONLY outside production", () => {
    const source = read(ERROR_STATE);
    expect(source).toMatch(/isDev\s*=\s*process\.env\.NODE_ENV\s*!==\s*"production"/);
    // The only render of `error.message` must be behind the isDev guard.
    expect(source).toMatch(/isDev\s*&&\s*error\.message/);
  });

  it("never renders a stack trace", () => {
    for (const file of [ERROR_STATE, DASHBOARD_ERROR, ROOT_ERROR, GLOBAL_ERROR]) {
      expect(read(file), file).not.toContain("error.stack");
    }
  });

  it("logs only the digest (message is the dev-only fallback)", () => {
    for (const file of [DASHBOARD_ERROR, ROOT_ERROR, GLOBAL_ERROR]) {
      expect(read(file), file).toMatch(/error\.digest \?\? error\.message/);
    }
  });
});

describe("global-error is self-sufficient", () => {
  const source = read(GLOBAL_ERROR);

  it("renders its own <html> and <body> — it replaces the root layout", () => {
    expect(source).toContain("<html");
    expect(source).toContain("<body");
    expect(source).toContain('lang="pt-BR"');
  });

  it("imports NOTHING but React", () => {
    // If the root layout blew up, any shared import might blow up too. The
    // last-resort boundary must not depend on the design system, next/link,
    // or an icon package.
    const imports = [...source.matchAll(/^import .*?from "(.*?)";$/gm)].map((match) => match[1]);
    expect(imports).toEqual(["react"]);
  });

  it("styles everything inline — the app CSS may never have loaded", () => {
    expect(source).toContain("style={{");
    expect(source).not.toContain("className=");
  });

  it("uses a plain anchor, with the lint exception justified in a comment", () => {
    expect(source).toContain('href="/"');
    expect(source).toContain("@next/next/no-html-link-for-pages");
    expect(source).toMatch(/router may not be mounted/);
  });

  it("still exposes the digest and a Recarregar action", () => {
    expect(source).toContain("error.digest");
    expect(source).toContain("Recarregar");
    expect(source).toContain("onClick={reset}");
  });

  it("honours radius 16 from §13 even in its inline styles", () => {
    expect(source).toContain('borderRadius: "16px"');
  });
});

describe("boundary routing", () => {
  it("the dashboard boundary sends the user back to the dashboard", () => {
    // Default homeHref in ErrorState is /dashboard, so no override is needed.
    const source = read(DASHBOARD_ERROR);
    expect(source).toContain("<ErrorState error={error} reset={reset} />");
  });

  it("the root boundary sends the user home, NOT into a protected route", () => {
    // A visitor who errored on /login has no dashboard; routing them there
    // would bounce straight back through the middleware to /login.
    const source = read(ROOT_ERROR);
    expect(source).toContain('homeHref="/"');
    expect(source).toContain('homeLabel="Voltar para a home"');
  });

  it("each boundary tags its console log with a distinct scope", () => {
    expect(read(DASHBOARD_ERROR)).toContain("[dashboard.error]");
    expect(read(ROOT_ERROR)).toContain("[app.error]");
    expect(read(GLOBAL_ERROR)).toContain("[app.global-error]");
  });
});
