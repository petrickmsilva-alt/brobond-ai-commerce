import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TENANT_SETTINGS,
  FREEMAIL_DOMAINS,
  ONBOARDING_STEPS,
  RESERVED_SLUGS,
  TENANT_SLUG_FALLBACK,
  TENANT_SLUG_MAX_LENGTH,
  countCompletedSteps,
  defaultCompanyFromEmail,
  defaultWorkspaceName,
  deriveOnboardingProgress,
  displayNameFromEmail,
  isOnboardingComplete,
  resolveTenantSlug,
  tenantSlugBase,
} from "@/modules/auth/tenant-provisioning";

/**
 * PR010.4 — the pure rules behind first-tenant setup.
 *
 * This module has no Prisma and no `server-only`, which is the whole point:
 * the decisions that shape a brand-new workspace (its slug, its defaults, its
 * checklist) are testable exhaustively without a database, and changing one is
 * a one-line diff with a test beside it.
 */

// ------------------------------------------------------------------
// Slugs
// ------------------------------------------------------------------

describe("tenantSlugBase()", () => {
  it("lowercases and hyphenates a company name", () => {
    expect(tenantSlugBase("Brobond Commerce")).toBe("brobond-commerce");
  });

  it("folds Portuguese accents instead of mangling them", () => {
    expect(tenantSlugBase("Café Belíssimo")).toBe("cafe-belissimo");
  });

  it("folds a cedilla", () => {
    expect(tenantSlugBase("Conceição Ltda")).toBe("conceicao-ltda");
  });

  it("collapses runs of punctuation into one hyphen", () => {
    expect(tenantSlugBase("Acme   &&&   Co")).toBe("acme-co");
  });

  it("drops leading and trailing separators", () => {
    expect(tenantSlugBase("  --Acme--  ")).toBe("acme");
  });

  it("keeps digits", () => {
    expect(tenantSlugBase("99 Taxis")).toBe("99-taxis");
  });

  it("falls back when nothing sluggable remains", () => {
    expect(tenantSlugBase("***")).toBe(TENANT_SLUG_FALLBACK);
  });

  it("falls back for an empty string", () => {
    expect(tenantSlugBase("")).toBe(TENANT_SLUG_FALLBACK);
  });

  it("falls back for whitespace only", () => {
    expect(tenantSlugBase("   ")).toBe(TENANT_SLUG_FALLBACK);
  });

  it("falls back for a name made only of emoji", () => {
    expect(tenantSlugBase("🚀🚀")).toBe(TENANT_SLUG_FALLBACK);
  });

  it(`truncates to ${TENANT_SLUG_MAX_LENGTH} characters`, () => {
    expect(tenantSlugBase("a".repeat(200)).length).toBeLessThanOrEqual(TENANT_SLUG_MAX_LENGTH);
  });

  it("never leaves a trailing hyphen after truncation", () => {
    const slug = tenantSlugBase(`${"ab ".repeat(40)}`);
    expect(slug.endsWith("-")).toBe(false);
  });

  it.each(RESERVED_SLUGS)("suffixes the reserved slug %s so it cannot shadow a route", (word) => {
    expect(tenantSlugBase(word)).toBe(`${word}-workspace`);
  });

  it("does not suffix a company that merely contains a reserved word", () => {
    expect(tenantSlugBase("Admin Tools")).toBe("admin-tools");
  });

  it("reserves the routes this app actually serves", () => {
    for (const route of ["login", "signup", "dashboard", "settings", "api", "invite"]) {
      expect(RESERVED_SLUGS).toContain(route);
    }
  });
});

describe("resolveTenantSlug()", () => {
  const free = async () => false;
  const taken = async () => true;

  it("returns the base slug when it is free", async () => {
    expect(await resolveTenantSlug("Brobond", free)).toBe("brobond");
  });

  it("appends -2 on the first collision", async () => {
    const isTaken = vi.fn(async (candidate: string) => candidate === "brobond");
    expect(await resolveTenantSlug("Brobond", isTaken)).toBe("brobond-2");
  });

  it("appends -3 when -2 is also taken", async () => {
    const used = new Set(["brobond", "brobond-2"]);
    expect(await resolveTenantSlug("Brobond", async (c) => used.has(c))).toBe("brobond-3");
  });

  it("walks past a long run of collisions", async () => {
    const used = new Set(["brobond", ...Array.from({ length: 20 }, (_, i) => `brobond-${i + 2}`)]);
    expect(await resolveTenantSlug("Brobond", async (c) => used.has(c))).toBe("brobond-22");
  });

  it("checks the base candidate first", async () => {
    const isTaken = vi.fn(free);
    await resolveTenantSlug("Brobond", isTaken);
    expect(isTaken).toHaveBeenNthCalledWith(1, "brobond");
  });

  it("stops asking once it finds a free candidate", async () => {
    const isTaken = vi.fn(async (candidate: string) => candidate === "brobond");
    await resolveTenantSlug("Brobond", isTaken);
    expect(isTaken).toHaveBeenCalledTimes(2);
  });

  it("terminates even when everything is taken", async () => {
    const slug = await resolveTenantSlug("Brobond", taken);
    expect(slug).toMatch(/^brobond-/);
    expect(slug.length).toBeLessThanOrEqual(TENANT_SLUG_MAX_LENGTH);
  });

  it("keeps a suffixed slug within the length budget", async () => {
    const used = new Set([tenantSlugBase("a".repeat(200))]);
    const slug = await resolveTenantSlug("a".repeat(200), async (c) => used.has(c));
    expect(slug.length).toBeLessThanOrEqual(TENANT_SLUG_MAX_LENGTH);
  });

  it("applies the reserved-word rule before collision handling", async () => {
    expect(await resolveTenantSlug("Dashboard", free)).toBe("dashboard-workspace");
  });
});

// ------------------------------------------------------------------
// Workspace name + defaults
// ------------------------------------------------------------------

describe("defaultWorkspaceName()", () => {
  it("uses the company name verbatim", () => {
    expect(defaultWorkspaceName("Brobond Commerce")).toBe("Brobond Commerce");
  });

  it("trims surrounding whitespace", () => {
    expect(defaultWorkspaceName("  Brobond  ")).toBe("Brobond");
  });

  it("keeps accents and punctuation — this is a display name, not a slug", () => {
    expect(defaultWorkspaceName("Açaí & Cia Ltda.")).toBe("Açaí & Cia Ltda.");
  });

  it("falls back for an empty name", () => {
    expect(defaultWorkspaceName("")).toBe("Meu workspace");
  });

  it("falls back for whitespace only", () => {
    expect(defaultWorkspaceName("   ")).toBe("Meu workspace");
  });
});

describe("DEFAULT_TENANT_SETTINGS", () => {
  it("defaults to Brazilian Real", () => {
    expect(DEFAULT_TENANT_SETTINGS.currency).toBe("BRL");
  });

  it("defaults to pt-BR", () => {
    expect(DEFAULT_TENANT_SETTINGS.locale).toBe("pt-BR");
  });

  it("defaults to São Paulo time", () => {
    expect(DEFAULT_TENANT_SETTINGS.timezone).toBe("America/Sao_Paulo");
  });

  it("carries nothing secret", () => {
    const serialized = JSON.stringify(DEFAULT_TENANT_SETTINGS).toLowerCase();
    for (const forbidden of ["secret", "token", "password", "key"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

// ------------------------------------------------------------------
// §9 — the onboarding checklist
// ------------------------------------------------------------------

describe("ONBOARDING_STEPS (§9)", () => {
  it("has exactly the four steps the PR asks for", () => {
    expect(ONBOARDING_STEPS.map((step) => step.title)).toEqual([
      "Conectar TikTok",
      "Importar Produtos",
      "Criar Creator",
      "Criar Campanha",
    ]);
  });

  it("orders them so each step makes the next one possible", () => {
    const ids = ONBOARDING_STEPS.map((step) => step.id);
    expect(ids.indexOf("import-products")).toBeLessThan(ids.indexOf("create-campaign"));
    expect(ids.indexOf("create-creator")).toBeLessThan(ids.indexOf("create-campaign"));
  });

  it("gives every step a destination inside the dashboard", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.href.startsWith("/dashboard")).toBe(true);
    }
  });

  it("gives every step a description, not just a title", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.description.length).toBeGreaterThan(20);
    }
  });

  it("gives every step a unique id", () => {
    const ids = ONBOARDING_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("deriveOnboardingProgress()", () => {
  const EMPTY = { tiktokAccounts: 0, products: 0, creators: 0, campaigns: 0 };

  it("marks nothing done for a brand-new tenant", () => {
    expect(deriveOnboardingProgress(EMPTY)).toEqual({
      "connect-tiktok": false,
      "import-products": false,
      "create-creator": false,
      "create-campaign": false,
    });
  });

  it("ticks Conectar TikTok once an account exists", () => {
    expect(deriveOnboardingProgress({ ...EMPTY, tiktokAccounts: 1 })["connect-tiktok"]).toBe(true);
  });

  it("ticks Importar Produtos once a product exists", () => {
    expect(deriveOnboardingProgress({ ...EMPTY, products: 1 })["import-products"]).toBe(true);
  });

  it("ticks Criar Creator once a creator exists", () => {
    expect(deriveOnboardingProgress({ ...EMPTY, creators: 1 })["create-creator"]).toBe(true);
  });

  it("ticks Criar Campanha once a campaign exists", () => {
    expect(deriveOnboardingProgress({ ...EMPTY, campaigns: 1 })["create-campaign"]).toBe(true);
  });

  it("ticks a step however the thing was created — it is derived, not stored", () => {
    // A product imported by the TikTok sync counts exactly like a hand-typed
    // one: the checklist asks "does a product exist", not "did you use the
    // button we pointed at".
    expect(deriveOnboardingProgress({ ...EMPTY, products: 250 })["import-products"]).toBe(true);
  });

  it("treats a large count the same as one", () => {
    const many = deriveOnboardingProgress({
      tiktokAccounts: 9,
      products: 900,
      creators: 90,
      campaigns: 9,
    });
    expect(Object.values(many).every(Boolean)).toBe(true);
  });

  it("never reports a step for a negative count", () => {
    expect(deriveOnboardingProgress({ ...EMPTY, products: -1 })["import-products"]).toBe(false);
  });
});

describe("countCompletedSteps() / isOnboardingComplete()", () => {
  const EMPTY = { tiktokAccounts: 0, products: 0, creators: 0, campaigns: 0 };

  it("counts zero for a new tenant", () => {
    expect(countCompletedSteps(deriveOnboardingProgress(EMPTY))).toBe(0);
  });

  it("counts each finished step", () => {
    expect(countCompletedSteps(deriveOnboardingProgress({ ...EMPTY, products: 1 }))).toBe(1);
    expect(
      countCompletedSteps(deriveOnboardingProgress({ ...EMPTY, products: 1, creators: 1 })),
    ).toBe(2);
  });

  it("counts all four when everything is done", () => {
    const all = { tiktokAccounts: 1, products: 1, creators: 1, campaigns: 1 };
    expect(countCompletedSteps(deriveOnboardingProgress(all))).toBe(ONBOARDING_STEPS.length);
  });

  it("is incomplete while any step remains", () => {
    const three = { tiktokAccounts: 1, products: 1, creators: 1, campaigns: 0 };
    expect(isOnboardingComplete(deriveOnboardingProgress(three))).toBe(false);
  });

  it("is complete only when every step is done", () => {
    const all = { tiktokAccounts: 1, products: 1, creators: 1, campaigns: 1 };
    expect(isOnboardingComplete(deriveOnboardingProgress(all))).toBe(true);
  });
});

// ------------------------------------------------------------------
// §5 — inferring a profile Google never asked for
// ------------------------------------------------------------------

describe("displayNameFromEmail()", () => {
  it("title-cases a dotted local part", () => {
    expect(displayNameFromEmail("joao.silva@gmail.com")).toBe("Joao Silva");
  });

  it("handles underscores", () => {
    expect(displayNameFromEmail("ana_ribeiro@x.com")).toBe("Ana Ribeiro");
  });

  it("handles hyphens", () => {
    expect(displayNameFromEmail("ana-ribeiro@x.com")).toBe("Ana Ribeiro");
  });

  it("handles a single-word local part", () => {
    expect(displayNameFromEmail("ana@x.com")).toBe("Ana");
  });

  it("falls back for an empty local part", () => {
    expect(displayNameFromEmail("@x.com")).toBe("Usuário");
  });

  it("falls back for a local part of only separators", () => {
    expect(displayNameFromEmail("...@x.com")).toBe("Usuário");
  });

  it("caps the derived name at 120 characters", () => {
    expect(displayNameFromEmail(`${"a".repeat(300)}@x.com`).length).toBeLessThanOrEqual(120);
  });
});

describe("defaultCompanyFromEmail()", () => {
  it("uses the domain label for a corporate address", () => {
    expect(defaultCompanyFromEmail("ana@brobond.ai")).toBe("Brobond");
  });

  it("uses the first label of a multi-part domain", () => {
    expect(defaultCompanyFromEmail("ana@empresa.com.br")).toBe("Empresa");
  });

  it.each(FREEMAIL_DOMAINS)("never treats %s as a company", (domain) => {
    expect(defaultCompanyFromEmail(`ana@${domain}`, "Ana Ribeiro")).toBe(
      "Workspace de Ana Ribeiro",
    );
  });

  it("falls back to the derived name when no name is given", () => {
    expect(defaultCompanyFromEmail("joao.silva@gmail.com")).toBe("Workspace de Joao Silva");
  });

  it("covers the free-mail providers Brazilians actually use", () => {
    for (const domain of ["gmail.com", "hotmail.com", "uol.com.br", "bol.com.br"]) {
      expect(FREEMAIL_DOMAINS).toContain(domain);
    }
  });

  it("caps the fallback at the company length budget", () => {
    const long = defaultCompanyFromEmail("ana@gmail.com", "A".repeat(400));
    expect(long.length).toBeLessThanOrEqual(160);
  });

  it("is case-insensitive about the domain", () => {
    expect(defaultCompanyFromEmail("ana@BROBOND.AI")).toBe("Brobond");
  });

  it("never returns an empty string", () => {
    for (const email of ["a@b.co", "@gmail.com", "x@gmail.com"]) {
      expect(defaultCompanyFromEmail(email).length).toBeGreaterThan(0);
    }
  });
});
