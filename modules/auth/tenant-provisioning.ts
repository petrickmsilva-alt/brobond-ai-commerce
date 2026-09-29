/**
 * First-tenant provisioning primitives (PR010.4 §4).
 *
 * PURE MODULE — no Prisma, no NextAuth, no `server-only`. Everything here is
 * a data transformation, which is why it can be unit-tested exhaustively
 * without a database. The service (`signup.service.ts`) does the writing; this
 * file decides *what* gets written.
 *
 * WHY SPLIT IT OUT
 * ----------------
 * "Criar Organization + User + Workspace + configurações padrão + seed
 * inicial" is five decisions, and every one of them is a rule someone will
 * want to change later (the default currency, the workspace name, the slug
 * collision strategy, which templates a new tenant starts with). Keeping them
 * pure and named means changing one is a one-line diff with a test next to it,
 * instead of an edit inside a transaction body.
 */

/** Reserved slugs that may never become a tenant slug. */
export const RESERVED_SLUGS: readonly string[] = [
  "admin",
  "api",
  "app",
  "auth",
  "dashboard",
  "invite",
  "login",
  "logout",
  "new",
  "public",
  "settings",
  "signup",
  "static",
  "support",
  "system",
  "www",
] as const;

/** Maximum length of a generated tenant slug. */
export const TENANT_SLUG_MAX_LENGTH = 48;

/** Fallback used when a company name contains nothing sluggable (e.g. "***"). */
export const TENANT_SLUG_FALLBACK = "workspace";

/** Workspace defaults applied to every tenant created through `/signup`. */
export const DEFAULT_TENANT_SETTINGS = {
  currency: "BRL",
  locale: "pt-BR",
  timezone: "America/Sao_Paulo",
} as const;

export type TenantSettings = typeof DEFAULT_TENANT_SETTINGS;

/**
 * Slugify a company name into a tenant slug candidate.
 *
 * Accent-folding matters here: "Café Belíssimo" must become `cafe-belissimo`,
 * not `caf-bel-ssimo`, or the first thing a Brazilian user sees about their
 * brand-new workspace is their own company name mangled.
 */
export function tenantSlugBase(company: string): string {
  const slug = company
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, TENANT_SLUG_MAX_LENGTH)
    .replace(/-+$/, "");

  if (!slug) return TENANT_SLUG_FALLBACK;
  // A reserved word would collide with a real route if it ever reached a URL.
  if (RESERVED_SLUGS.includes(slug)) return `${slug}-workspace`;
  return slug;
}

/**
 * Resolve a globally unique tenant slug.
 *
 * `Organization.slug` is unique across the whole database (it is not
 * tenant-scoped — it IS the tenant), so two companies called "Acme" must not
 * race each other into the same row. The caller supplies the "is this taken?"
 * predicate, which lets the service run it inside its transaction.
 */
export async function resolveTenantSlug(
  company: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = tenantSlugBase(company);
  if (!(await isTaken(base))) return base;

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const trimmed = base.slice(0, TENANT_SLUG_MAX_LENGTH - `-${suffix}`.length);
    const candidate = `${trimmed}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  // Practically unreachable, and guarantees termination with a unique value.
  const unique = Date.now().toString(36);
  return `${base.slice(0, TENANT_SLUG_MAX_LENGTH - unique.length - 1)}-${unique}`;
}

/**
 * The workspace display name for a new tenant.
 *
 * It starts as the company name — a first-run user should recognise their own
 * workspace immediately — but is stored separately so renaming the legal
 * entity later never silently renames the workspace people work in.
 */
export function defaultWorkspaceName(company: string): string {
  const trimmed = company.trim();
  return trimmed || "Meu workspace";
}

/** The five onboarding steps shown on `/dashboard` after the first login (§9). */
export const ONBOARDING_STEPS = [
  {
    id: "connect-tiktok",
    title: "Conectar TikTok",
    description: "Autorize sua conta TikTok Shop para sincronizar pedidos e creators.",
    href: "/dashboard/tiktok",
  },
  {
    id: "import-products",
    title: "Importar Produtos",
    description: "Traga seu catálogo — por importação do TikTok Shop ou manualmente.",
    href: "/dashboard/products",
  },
  {
    id: "create-creator",
    title: "Criar Creator",
    description: "Adicione o primeiro creator ao seu CRM e comece a construir o roster.",
    href: "/dashboard/creators",
  },
  {
    id: "create-campaign",
    title: "Criar Campanha",
    description: "Conecte produtos e creators na sua primeira campanha.",
    href: "/dashboard/campaigns",
  },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

/** Live completion state of the onboarding checklist. */
export type OnboardingProgress = Record<OnboardingStepId, boolean>;

/** Counts the checklist reads to decide which steps are already done. */
export interface OnboardingCounters {
  tiktokAccounts: number;
  products: number;
  creators: number;
  campaigns: number;
}

/**
 * Derive the checklist state from tenant counters.
 *
 * DERIVED, NOT STORED: a step is done when the thing it asks for exists. That
 * way the checklist can never disagree with reality — a user who imports a
 * product through any other route still sees the step tick.
 */
export function deriveOnboardingProgress(counters: OnboardingCounters): OnboardingProgress {
  return {
    "connect-tiktok": counters.tiktokAccounts > 0,
    "import-products": counters.products > 0,
    "create-creator": counters.creators > 0,
    "create-campaign": counters.campaigns > 0,
  };
}

/** How many of the checklist steps are complete. */
export function countCompletedSteps(progress: OnboardingProgress): number {
  return ONBOARDING_STEPS.filter((step) => progress[step.id]).length;
}

/** Whether every onboarding step is done. */
export function isOnboardingComplete(progress: OnboardingProgress): boolean {
  return countCompletedSteps(progress) === ONBOARDING_STEPS.length;
}

/**
 * A display name for a user who signed up without one (Google can return a
 * profile with no `name`), derived from the local part of their email.
 */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "Usuário";
  return cleaned
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 120);
}

/**
 * The company name to use for a Google first-access user, who never typed one
 * (§5). Their email domain is the best available signal; a free-mail domain
 * says nothing, so those fall back to the person's own name.
 */
export const FREEMAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "bol.com.br",
  "uol.com.br",
  "terra.com.br",
] as const;

export function defaultCompanyFromEmail(email: string, name?: string | null): string {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  if (domain && !FREEMAIL_DOMAINS.includes(domain)) {
    const label = domain.split(".")[0] ?? "";
    if (label) return label.charAt(0).toUpperCase() + label.slice(1);
  }

  const person = name?.trim() || displayNameFromEmail(email);
  return `Workspace de ${person}`.slice(0, 160);
}
