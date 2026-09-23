import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PR010.4 §2 · §3 · §6 · §7 · §8 · §9 — UI contracts, asserted on the source.
 *
 * These are source-level contracts, not rendering tests. The things this PR
 * promises about the interface — a two-column signup, a "Criar conta" button
 * on the login screen, errors under their fields, the onboarding panel on the
 * dashboard — are structural, and a structural promise is exactly what a
 * future refactor silently breaks. Reading the files is how that gets caught.
 */

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const exists = (relative: string) => existsSync(join(ROOT, relative));

const signupPage = read("app/signup/page.tsx");
const signupForm = read("components/auth/signup-form.tsx");
const signupAction = read("app/signup/actions.ts");
const loginPage = read("app/login/page.tsx");
const landingPage = read("app/page.tsx");
const landingHeader = read("components/marketing/landing-header.tsx");
const dashboardPage = read("app/dashboard/page.tsx");
const checklist = read("components/dashboard/onboarding-checklist.tsx");

// ------------------------------------------------------------------
// §2 — the route
// ------------------------------------------------------------------

describe("§2 — /signup exists", () => {
  it("has a page", () => {
    expect(exists("app/signup/page.tsx")).toBe(true);
  });

  it("has a server action", () => {
    expect(exists("app/signup/actions.ts")).toBe(true);
  });

  it("has a form component", () => {
    expect(exists("components/auth/signup-form.tsx")).toBe(true);
  });

  it("is a Server Component (the form is the only client boundary)", () => {
    expect(signupPage.startsWith('"use client"')).toBe(false);
  });

  it("the action is a server action", () => {
    expect(signupAction.startsWith('"use server"')).toBe(true);
  });

  it("the form is a client component", () => {
    expect(signupForm.startsWith('"use client"')).toBe(true);
  });

  it("has a page title", () => {
    expect(signupPage).toMatch(/title:\s*"Criar conta"/);
  });
});

describe("§2 — premium two-column layout", () => {
  it("uses a two-column grid", () => {
    expect(signupPage).toMatch(/lg:grid-cols-\[/);
  });

  it("renders a brand aside for the left column", () => {
    expect(signupPage).toContain("<aside");
  });

  it("renders a main region for the form column", () => {
    expect(signupPage).toContain("<main");
  });

  it("uses the glass card treatment", () => {
    expect(signupPage).toMatch(/glass-panel|glass-edge/);
  });

  it("uses the premium background treatments", () => {
    expect(signupPage).toMatch(/bg-premium-glow/);
    expect(signupPage).toMatch(/bg-app-mesh/);
  });

  it("animates with the shared motion primitives", () => {
    expect(signupPage).toMatch(/from "@\/components\/ui\/motion"/);
  });

  it("shows the platform status, like the login screen does", () => {
    expect(signupPage).toContain("PlatformStatus");
  });

  it("collapses to a single column on small screens", () => {
    expect(signupPage).toMatch(/hidden[^"]*lg:flex/);
  });
});

describe("§2 — an authenticated visitor never sees the form", () => {
  it("resolves the session server-side", () => {
    expect(signupPage).toContain("getCurrentUser");
  });

  it("redirects them away", () => {
    expect(signupPage).toMatch(/if \(user\) redirect\(/);
  });

  it("sanitises ?next= before using it", () => {
    expect(signupPage).toContain("sanitizeNext");
  });
});

// ------------------------------------------------------------------
// §3 — the form
// ------------------------------------------------------------------

describe("§3 — every required field is present", () => {
  it.each([
    ["name", "Nome completo"],
    ["company", "Empresa"],
    ["whatsapp", "WhatsApp"],
    ["email", "Email"],
    ["password", "Senha"],
    ["confirmPassword", "Confirmar senha"],
    ["acceptTerms", "Termos"],
  ])("renders the %s field labelled %s", (id, label) => {
    expect(signupForm).toContain(`id="${id}"`);
    expect(signupForm).toContain(label);
  });

  it("uses a checkbox for the terms", () => {
    expect(signupForm).toMatch(/id="acceptTerms"[\s\S]{0,120}type="checkbox"/);
  });

  it("uses a tel input for WhatsApp", () => {
    expect(signupForm).toMatch(/type: "tel"/);
  });

  it("asks the browser for a new password, not the saved one", () => {
    expect(signupForm).toMatch(/autoComplete="new-password"/);
  });

  it("offers a show/hide toggle for both password fields", () => {
    expect(signupForm).toContain("showPassword");
    expect(signupForm).toContain("showConfirm");
  });

  it("shows the password strength meter", () => {
    expect(signupForm).toContain("PasswordStrength");
  });

  it("has a submit button labelled 'Criar conta'", () => {
    expect(signupForm).toMatch(/Criar conta/);
  });

  it("disables the submit while in flight", () => {
    expect(signupForm).toMatch(/disabled=\{isSubmitting\}/);
  });
});

describe("§3 — validação em tempo real", () => {
  it("validates on change, not only on submit", () => {
    expect(signupForm).toMatch(/mode:\s*"onChange"/);
  });

  it("re-validates on change after the first error", () => {
    expect(signupForm).toMatch(/reValidateMode:\s*"onChange"/);
  });

  it("uses the SAME schema the server uses", () => {
    expect(signupForm).toContain("signupFormSchema");
    expect(signupAction).toContain("signupSchema");
  });

  it("disables native validation so the shared rules are the only ones", () => {
    expect(signupForm).toContain("noValidate");
  });
});

// ------------------------------------------------------------------
// §8 — errors below the field
// ------------------------------------------------------------------

describe("§8 — errors are rendered UNDER their field", () => {
  it("has a dedicated per-field error component", () => {
    expect(signupForm).toContain("function FieldError");
  });

  it("marks each field error in the DOM for testability", () => {
    expect(signupForm).toContain("data-field-error");
  });

  it("wires aria-invalid on every input", () => {
    expect(signupForm).toMatch(/aria-invalid/);
  });

  it("wires aria-describedby to the error element", () => {
    expect(signupForm).toMatch(/aria-describedby/);
  });

  it("replays SERVER field errors onto their inputs", () => {
    expect(signupForm).toContain("result.fieldErrors");
    expect(signupForm).toContain("setError(");
  });

  it("renders the summary as an alert live region", () => {
    expect(signupForm).toMatch(/role="alert"/);
  });

  it("never renders the generic 'Revise os campos destacados'", () => {
    expect(signupForm).not.toMatch(/Revise os campos destacados/);
    expect(signupAction).not.toMatch(/error: "Revise os campos destacados/);
  });

  it("the action returns fieldErrors, not just a banner", () => {
    expect(signupAction).toContain("fieldErrors");
  });

  it("the action names a concrete first problem as its summary", () => {
    expect(signupAction).toContain("firstMessage");
  });

  it("the action maps a duplicate email to the email field", () => {
    expect(signupAction).toMatch(/fieldErrors:\s*\{\s*email:/);
  });

  it("the action maps P2002 (the unique index) to a friendly message", () => {
    expect(signupAction).toContain("P2002");
  });
});

// ------------------------------------------------------------------
// §6 — the login screen
// ------------------------------------------------------------------

describe("§6 — /login offers 'Criar conta'", () => {
  it("renders a Criar conta affordance", () => {
    expect(loginPage).toMatch(/Criar conta/);
  });

  it("renders it as a real button, not a footnote link", () => {
    expect(loginPage).toMatch(/login-signup-cta/);
    expect(loginPage).toMatch(/<Button variant="outline" size="lg"/);
  });

  it("points it at /signup through the shared builder", () => {
    expect(loginPage).toContain("buildSignupUrl");
  });

  it("preserves the ?next= destination across the hand-off", () => {
    expect(loginPage).toMatch(/buildSignupUrl\(next\)/);
  });

  it("no longer links to the deleted request-access flow", () => {
    expect(loginPage).not.toContain("/request-access");
  });

  it("no longer claims there is no public cadastro", () => {
    expect(loginPage).not.toMatch(/não há cadastro público/);
  });
});

// ------------------------------------------------------------------
// §7 — the landing page
// ------------------------------------------------------------------

describe("§7 — the landing page", () => {
  it("offers 'Criar Conta' as the secondary CTA", () => {
    expect(landingPage).toMatch(/Criar Conta/);
    expect(landingPage).toContain("landing-signup-cta");
  });

  it("keeps 'Fazer Login' available", () => {
    expect(landingPage).toMatch(/Fazer Login/);
    expect(landingPage).toContain("landing-login-cta");
  });

  it("points the signup CTA at the route constant, not a literal", () => {
    expect(landingPage).toContain("SIGNUP_ROUTE");
  });

  it("no longer offers 'Solicitar acesso'", () => {
    // Only the rendered markup matters — the file still *mentions* the old
    // flow in a comment explaining why it is gone.
    const markup = landingPage.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(markup).not.toMatch(/Solicitar acesso/);
    expect(markup).not.toContain("/request-access");
  });

  it("the header offers 'Criar conta' to a visitor", () => {
    expect(landingHeader).toMatch(/Criar conta/);
    expect(landingHeader).toContain("landing-header-signup-cta");
  });

  it("the header hides it from an authenticated user", () => {
    expect(landingHeader).toMatch(/\{!authenticated && \(/);
  });

  it("the header keeps 'Entrar'", () => {
    expect(landingHeader).toMatch(/Entrar/);
  });
});

// ------------------------------------------------------------------
// §5 — Google on the signup screen
// ------------------------------------------------------------------

describe("§5 — Google first access is offered on /signup", () => {
  it("renders the SSO buttons", () => {
    expect(signupPage).toContain("SsoButtons");
  });

  it("renders them only when the provider is configured", () => {
    expect(signupPage).toContain("showGoogleProvider");
    expect(signupPage).toMatch(/\{google && \(/);
  });

  it("forwards a sanitised callback destination", () => {
    expect(signupPage).toMatch(/callbackUrl=\{resolveNext\(next\)\}/);
  });
});

// ------------------------------------------------------------------
// §9 — the dashboard onboarding
// ------------------------------------------------------------------

describe("§9 — the onboarding checklist on /dashboard", () => {
  it("has a component", () => {
    expect(exists("components/dashboard/onboarding-checklist.tsx")).toBe(true);
  });

  it("has a dismiss action", () => {
    expect(exists("app/dashboard/onboarding-actions.ts")).toBe(true);
  });

  it("is rendered by the dashboard", () => {
    expect(dashboardPage).toContain("OnboardingChecklist");
  });

  it("is rendered only while it is relevant", () => {
    expect(dashboardPage).toMatch(/\{onboarding\.visible && \(/);
  });

  it("reads its state from the service, not from props invented in the page", () => {
    expect(dashboardPage).toContain("onboardingService.getState");
  });

  it("scopes that read to the session tenant", () => {
    expect(dashboardPage).toMatch(/onboardingService\.getState\(organizationId\)/);
  });

  it("names all four §9 steps", () => {
    const provisioning = read("modules/auth/tenant-provisioning.ts");
    for (const title of [
      "Conectar TikTok",
      "Importar Produtos",
      "Criar Creator",
      "Criar Campanha",
    ]) {
      expect(provisioning, title).toContain(title);
    }
  });

  it("renders the steps as an ordered list", () => {
    expect(checklist).toContain("<ol");
  });

  it("marks completion in TEXT, not by colour alone", () => {
    expect(checklist).toContain("Concluído");
  });

  it("gives the dismiss control an accessible name", () => {
    expect(checklist).toMatch(/aria-label="Dispensar/);
  });

  it("exposes a testable hook per step", () => {
    expect(checklist).toContain("onboarding-step-");
  });

  it("leaves the panel visible when a dismissal fails", () => {
    expect(checklist).toMatch(/setDismissing\(false\)/);
  });
});

describe("§9 — the dismiss action is tenant-safe", () => {
  const action = read("app/dashboard/onboarding-actions.ts");

  it("is a server action", () => {
    expect(action.startsWith('"use server"')).toBe(true);
  });

  it("resolves the tenant from the SESSION", () => {
    expect(action).toContain("requireOrganization");
  });

  it("accepts no payload at all — nothing to point elsewhere", () => {
    expect(action).toMatch(/export async function dismissOnboardingAction\(\)/);
  });

  it("revalidates the dashboard", () => {
    expect(action).toContain('revalidatePath("/dashboard")');
  });

  it("handles an expired session gracefully", () => {
    expect(action).toContain("AuthorizationError");
  });
});

// ------------------------------------------------------------------
// Security surface of the new client code
// ------------------------------------------------------------------

describe("no secret reaches the signup bundle", () => {
  it("the form reads no environment secret", () => {
    for (const forbidden of [
      "AUTH_SECRET",
      "AUTH_GOOGLE_SECRET",
      "DATABASE_URL",
      "process.env.AUTH",
    ]) {
      expect(signupForm, forbidden).not.toContain(forbidden);
    }
  });

  it("the form never imports prisma", () => {
    expect(signupForm).not.toContain('from "@/lib/prisma"');
  });

  it("the form never imports a server-only service", () => {
    expect(signupForm).not.toContain("@/modules/auth/signup.service");
  });

  it("the checklist never imports prisma", () => {
    expect(checklist).not.toContain('from "@/lib/prisma"');
  });

  it("the form has no role input for a client to tamper with", () => {
    expect(signupForm).not.toMatch(/name="role"|id="role"/);
  });

  it("the form has no organizationId input", () => {
    expect(signupForm).not.toMatch(/name="organizationId"|id="organizationId"/);
  });

  it("the server-side signup service is marked server-only", () => {
    expect(read("modules/auth/signup.service.ts")).toContain('import "server-only"');
  });

  it("the onboarding service is marked server-only", () => {
    expect(read("modules/auth/onboarding.service.ts")).toContain('import "server-only"');
  });

  it("the tenant-aware adapter is marked server-only", () => {
    expect(read("lib/auth-adapter.ts")).toContain('import "server-only"');
  });

  it("the pure provisioning rules are NOT server-only (they are safe anywhere)", () => {
    expect(read("modules/auth/tenant-provisioning.ts")).not.toContain('import "server-only"');
  });
});
