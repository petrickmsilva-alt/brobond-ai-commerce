import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AUTHENTICATED_REDIRECT, LOGIN_ROUTE, buildLoginUrl } from "@/lib/auth-routes";

/**
 * PR010.2 §1 / §3 / §4 / §9 / §10 / §11 — UI contract tests.
 *
 * Vitest runs in a `node` environment here with no DOM library, so these
 * assert over the source (the pattern `tests/delivery-tenant.test.ts`
 * established). They catch the regressions that actually happen: a CTA being
 * re-pointed at a protected route, a disabled Google button creeping back,
 * a loading file being deleted, or a secret being handed to a Client
 * Component.
 */

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const exists = (relative: string) => existsSync(join(ROOT, relative));

/**
 * Source with comments stripped.
 *
 * These files document their own security rules in prose ("not a disabled
 * button", "AUTH_GOOGLE_SECRET is never serialized"), so a naive substring
 * search matches the explanation rather than the code. Assertions about what
 * the component *does* run against this stripped view; assertions about the
 * documentation itself use `read()`.
 */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("§1 — the landing Dashboard CTA never navigates blindly", () => {
  const source = read("components/marketing/landing-header.tsx");

  it("chooses the href from the session, server-side", () => {
    expect(source).toMatch(/authenticated\s*\?\s*DEFAULT_AUTHENTICATED_REDIRECT/);
    expect(source).toMatch(/buildLoginUrl\(DEFAULT_AUTHENTICATED_REDIRECT\)/);
  });

  it("never hardcodes a bare /dashboard href", () => {
    // The whole bug was `href="/dashboard"` on a public page.
    expect(source).not.toMatch(/href="\/dashboard"/);
  });

  it("the unauthenticated href is exactly /login?next=%2Fdashboard", () => {
    expect(buildLoginUrl(DEFAULT_AUTHENTICATED_REDIRECT)).toBe("/login?next=%2Fdashboard");
  });

  it('"Entrar" always points at /login with no next', () => {
    expect(source).toContain("<Link href={LOGIN_ROUTE}>");
    expect(LOGIN_ROUTE).toBe("/login");
  });

  it("is a Server Component — it must not become interactive", () => {
    expect(source.startsWith('"use client"')).toBe(false);
  });

  it("receives a boolean, never the session object", () => {
    expect(source).toMatch(/authenticated: boolean/);
    expect(source).not.toContain("session.user");
  });

  it("the landing page resolves the session and passes it down", () => {
    const page = read("app/page.tsx");
    expect(page).toContain("LandingHeader");
    expect(page).toMatch(/authenticated=\{/);
  });
});

describe("§4 — Google SSO is hidden, never disabled", () => {
  const source = read("components/auth/sso-buttons.tsx");

  it("returns null when the provider is absent", () => {
    expect(source).toMatch(/if \(!google\) return null;/);
  });

  it("NEVER renders a disabled control", () => {
    // The literal regression PR010.2 exists to remove. Checked against the
    // comment-stripped source — the file explains the rule in prose.
    const stripped = code("components/auth/sso-buttons.tsx");
    expect(stripped).not.toContain("disabled");
  });

  it("takes a boolean, never the credentials", () => {
    expect(source).toMatch(/google: boolean/);
    const stripped = code("components/auth/sso-buttons.tsx");
    expect(stripped).not.toContain("AUTH_GOOGLE_ID");
    expect(stripped).not.toContain("AUTH_GOOGLE_SECRET");
  });

  it("the login page derives visibility from showGoogleProvider()", () => {
    const page = read("app/login/page.tsx");
    expect(page).toContain("showGoogleProvider");
  });

  it("lib/auth.ts registers Google with the same predicate", () => {
    // If these drift, a visible button 404s or a usable provider stays hidden.
    expect(read("lib/auth.ts")).toContain("isGoogleProviderConfigured");
  });
});

describe("§3 — the login screen", () => {
  const page = read("app/login/page.tsx");
  const form = read("components/auth/login-form.tsx");

  it("offers email and senha fields", () => {
    expect(form).toMatch(/type="email"/);
    expect(form).toMatch(/type={showPassword \? "text" : "password"}|type="password"/);
  });

  it('has an "Entrar" submit action', () => {
    expect(form).toContain("Entrar");
  });

  it('links to "Esqueci minha senha"', () => {
    expect(form + page).toMatch(/\/forgot-password/);
    expect(form + page).toMatch(/Esqueci|Esqueceu/);
  });

  it('links to "Criar conta" — PR010.4 §6 replaced "Solicitar acesso"', () => {
    expect(form + page).toMatch(/buildSignupUrl|\/signup/);
    expect(form + page).toMatch(/Criar conta/);
  });

  it("no longer offers the deleted request-access flow", () => {
    expect(form + page).not.toContain("/request-access");
    expect(form + page).not.toMatch(/Solicitar acesso/);
  });

  it("no longer claims that public cadastro does not exist", () => {
    expect(page).not.toMatch(/não há cadastro público/);
  });

  it("renders the brand column with benefits and platform status", () => {
    expect(page).toContain("PlatformStatus");
  });

  it("uses the glass card treatment from §13", () => {
    expect(page + form).toMatch(/glass-panel|glass-edge/);
  });

  it("forwards a sanitised ?next= into the sign-in call", () => {
    expect(page).toContain("sanitizeNext");
  });
});

describe("§9 — loading states exist", () => {
  it.each([
    ["app/loading.tsx", "landing"],
    ["app/login/loading.tsx", "login"],
    ["app/dashboard/loading.tsx", "dashboard"],
  ])("%s (%s skeleton) is present", (file) => {
    expect(exists(file)).toBe(true);
  });

  it("the dashboard loading file renders a skeleton, not a spinner-only screen", () => {
    expect(read("app/dashboard/loading.tsx")).toMatch(/Skeleton/);
  });

  it("the skeleton primitives are exported for reuse", () => {
    const source = read("components/ui/skeleton.tsx");
    for (const symbol of [
      "PageHeaderSkeleton",
      "DashboardSkeleton",
      "ListPageSkeleton",
      "AuthCardSkeleton",
    ]) {
      expect(source, symbol).toContain(`export function ${symbol}`);
    }
  });

  it("skeletons are decorative and hidden from screen readers", () => {
    expect(read("components/ui/skeleton.tsx")).toContain("aria-hidden");
  });
});

describe("§10 — empty states carry a CTA", () => {
  const source = read("components/ui/table-empty-state.tsx");

  it("distinguishes 'no data yet' from 'filters matched nothing'", () => {
    expect(source).toContain("FILTER_KEYS");
    expect(source).toContain("useSearchParams");
    expect(source).toContain("Limpar filtros");
  });

  it("is consumed by every data table that can come back empty", () => {
    for (const file of [
      "components/products/products-table.tsx",
      "components/creators/creators-table.tsx",
      "components/connectors/content-table.tsx",
      "components/matches/match-table.tsx",
    ]) {
      expect(read(file), file).toContain("TableEmptyState");
    }
  });

  it("ships the CTAs the spec names", () => {
    const all =
      read("components/products/products-table.tsx") +
      read("components/creators/creators-table.tsx") +
      read("components/connectors/content-table.tsx");

    expect(all).toContain("Importar produtos");
    expect(all).toMatch(/Sincronizar TikTok/);
  });

  it("takes its CTA from the caller so RBAC stays on the page", () => {
    expect(read("components/products/products-table.tsx")).toContain("canEdit");
  });
});

describe("§11 — RBAC on the settings surfaces", () => {
  it("every privileged server action is gated by requireAdmin()", () => {
    const source = read("app/settings/actions.ts");
    const actions = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);

    expect(actions.length).toBeGreaterThan(0);
    // The real gate is server-side; hiding buttons is only cosmetic.
    expect(source).toContain("requireAdmin()");
  });

  it("the invitation role enum excludes ADMIN", () => {
    // An ADMIN cannot mint another ADMIN through an invite link.
    const source = code("lib/validations/auth.ts");
    const schema = source.slice(source.indexOf("createInvitationSchema"));
    const roleLine = schema.slice(0, schema.indexOf("});"));

    expect(roleLine).toMatch(/z\.enum\(\["MANAGER", "MEMBER"\]\)/);
    expect(roleLine).not.toContain('"ADMIN"');
  });

  it("MANAGER and MEMBER never see invite affordances", () => {
    const panel = read("components/settings/invitations-panel.tsx");
    expect(panel).toContain("canManage");
  });

  it("the access-request queue is GONE from the settings page (PR010.4 §1)", () => {
    const page = read("app/settings/page.tsx");
    expect(page).toContain("isAdmin");
    expect(page).not.toContain("AccessRequestsPanel");
    expect(page).not.toContain("accessRequestService");
  });

  it("the settings page states the role matrix for the user", () => {
    const page = read("app/settings/page.tsx");
    expect(page).toMatch(/ADMIN/);
    expect(page).toMatch(/MANAGER/);
    expect(page).toMatch(/MEMBER/);
  });
});

describe("§13 — design system", () => {
  it("radius 16 is the token", () => {
    expect(read("styles/globals.css")).toContain("--radius-2xl: 16px");
  });

  it("the glass and premium-gradient utilities exist", () => {
    const css = read("styles/globals.css");
    for (const utility of ["glass-panel", "glass-edge", "bg-premium-glow", "bg-app-mesh"]) {
      expect(css, utility).toContain(utility);
    }
  });

  it("the auth screens animate with Framer Motion", () => {
    for (const file of ["components/auth/auth-card-shell.tsx", "app/login/page.tsx"]) {
      expect(code(file), file).toMatch(/from "@\/components\/ui\/motion"/);
    }
  });

  it("the motion primitives honour prefers-reduced-motion", () => {
    // §13 asks for animation; accessibility asks for an opt-out. Both.
    expect(read("components/ui/motion.tsx")).toContain("useReducedMotion");
  });

  it("every new auth route has a page", () => {
    for (const file of [
      // PR010.4 §2 — /signup replaced /request-access.
      "app/signup/page.tsx",
      "app/forgot-password/page.tsx",
      "app/reset-password/page.tsx",
      "app/invite/[token]/page.tsx",
      // PR010.3 §10 — dedicated terminal/confirmation pages.
      "app/invite/invalid/page.tsx",
      "app/invite/expired/page.tsx",
    ]) {
      expect(exists(file), file).toBe(true);
    }
  });
});

describe("no secret reaches the browser", () => {
  it("no client component reads an AUTH_ secret", () => {
    const clientFiles = [
      "components/auth/sso-buttons.tsx",
      "components/auth/login-form.tsx",
      "components/auth/forgot-password-form.tsx",
      "components/auth/reset-password-form.tsx",
      "components/auth/accept-invitation-form.tsx",
      // PR010.4 §3 — the signup form is the new public client component, and
      // it handles a password, so it is the one most worth checking.
      "components/auth/signup-form.tsx",
      "components/settings/invitations-panel.tsx",
    ];

    for (const file of clientFiles) {
      const source = code(file);
      expect(source, file).not.toContain("AUTH_SECRET");
      expect(source, file).not.toContain("AUTH_GOOGLE_SECRET");
      expect(source, file).not.toContain("DATABASE_URL");
      expect(source, file).not.toContain("process.env.AUTH");
    }
  });

  it("no client component imports prisma", () => {
    for (const file of [
      "components/auth/login-form.tsx",
      "components/auth/signup-form.tsx",
      "components/settings/invitations-panel.tsx",
    ]) {
      expect(read(file), file).not.toContain('from "@/lib/prisma"');
    }
  });

  it("the dev-only reset token is never exposed in production", () => {
    const source = read("app/forgot-password/actions.ts");
    expect(source).toMatch(/NODE_ENV !== "production"/);
  });
});
