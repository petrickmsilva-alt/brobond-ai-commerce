import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";

/**
 * PR010.4 §4 · §5 — the signup service, against an in-memory fake Prisma.
 *
 * The service is built through `createSignupService(db)` exactly as production
 * does — only the database is faked — so these tests exercise the real
 * contract this PR is about:
 *
 *   1. one submission creates Organization + ADMIN User + Workspace + seed;
 *   2. the first user is ADMIN, and the role is never an input;
 *   3. the password is bcrypt-hashed and the plaintext is never stored;
 *   4. a duplicate email is refused with a FIELD-attributable error (§8);
 *   5. Google first access provisions a tenant; a returning Google user does
 *      not get a second one, and is not re-elevated to ADMIN.
 *
 * `@/lib/prisma` is mocked so importing the module never instantiates a real
 * client, and bcrypt is stubbed to keep the suite fast and deterministic.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async (plain: string) => `bcrypt$${plain}`),
}));

const { createSignupService, SignupError } = await import("@/modules/auth/signup.service");
const { OUTREACH_TEMPLATES } = await import("@/modules/outreach/prompts/templates");

type Row = Record<string, unknown>;

/** A signup payload shaped exactly like `signupSchema` output. */
const PAYLOAD = {
  name: "Ana Ribeiro",
  company: "Brobond Commerce",
  whatsapp: "11988887777",
  email: "ana@brobond.ai",
  password: "senha-super-secreta",
  confirmPassword: "senha-super-secreta",
  acceptTerms: true as const,
  next: null,
};

/** Minimal in-memory Prisma double covering the calls the service makes. */
function makeDb() {
  const organizations: Row[] = [];
  const users: Row[] = [];
  const messageTemplates: Row[] = [];
  const accounts: Row[] = [];
  let sequence = 0;

  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => row[key] === value);
  }

  const db = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        return organizations.find((row) => matches(row, where)) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        sequence += 1;
        const row = { id: `org_${sequence}`, createdAt: new Date(), ...data };
        organizations.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = organizations.find((item) => matches(item, where));
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where, select }: { where: Row; select?: Row }) => {
        const row = users.find((item) => matches(item, where));
        if (!row) return null;
        // Emulate the nested `organization` select the federated path uses.
        if (select && "organization" in select) {
          const organization = organizations.find((org) => org.id === row.organizationId);
          return { ...row, organization: organization ?? null };
        }
        return row;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        sequence += 1;
        const row = { id: `user_${sequence}`, createdAt: new Date(), ...data };
        users.push(row);
        return row;
      }),
    },
    messageTemplate: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        messageTemplates.push(...data);
        return { count: data.length };
      }),
    },
    account: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        accounts.push(data);
        return data;
      }),
    },
    // The fake transaction hands the same db back, which is exactly how the
    // Prisma interactive transaction behaves from the callback's point of view.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };

  return { db, organizations, users, messageTemplates };
}

let fake: ReturnType<typeof makeDb>;
let service: ReturnType<typeof createSignupService>;

beforeEach(() => {
  fake = makeDb();
  service = createSignupService(fake.db as never);
});

// ------------------------------------------------------------------
// §4 — what one signup creates
// ------------------------------------------------------------------

describe("register() — automatic provisioning", () => {
  it("creates exactly one Organization", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations).toHaveLength(1);
  });

  it("creates exactly one User", async () => {
    await service.register(PAYLOAD);
    expect(fake.users).toHaveLength(1);
  });

  it("names the Organization after the company", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations[0]!.name).toBe("Brobond Commerce");
  });

  it("derives a slug from the company name", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations[0]!.slug).toBe("brobond-commerce");
  });

  it("sets the workspace name (§4 — 'Criar Workspace')", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations[0]!.workspaceName).toBe("Brobond Commerce");
  });

  it("stores the contact WhatsApp on the tenant", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations[0]!.whatsapp).toBe("11988887777");
  });

  it("applies the default currency (§4 — 'configurações padrão')", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations[0]!.currency).toBe("BRL");
  });

  it("applies the default locale", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations[0]!.locale).toBe("pt-BR");
  });

  it("applies the default timezone", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations[0]!.timezone).toBe("America/Sao_Paulo");
  });

  it("marks the tenant as self-serve", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations[0]!.selfServe).toBe(true);
  });

  it("leaves onboarding UNfinished — §9 has something to show", async () => {
    await service.register(PAYLOAD);
    expect(fake.organizations[0]!.onboardingCompletedAt).toBeUndefined();
  });

  it("creates the seed templates (§4 — 'Criar seed inicial')", async () => {
    await service.register(PAYLOAD);
    expect(fake.messageTemplates).toHaveLength(OUTREACH_TEMPLATES.length);
  });

  it("scopes every seeded template to the new tenant", async () => {
    const result = await service.register(PAYLOAD);
    for (const template of fake.messageTemplates) {
      expect(template.organizationId).toBe(result.organizationId);
    }
  });

  it("seeds NO fake products — an invented dashboard is worse than an empty one", async () => {
    await service.register(PAYLOAD);
    // The fake db has no `product` delegate at all; using one would throw.
    expect(fake.db.messageTemplate.createMany).toHaveBeenCalledTimes(1);
  });

  it("runs the whole provisioning inside one transaction", async () => {
    await service.register(PAYLOAD);
    expect(fake.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns the ids the caller needs to sign the user in", async () => {
    const result = await service.register(PAYLOAD);
    expect(result.userId).toBeTruthy();
    expect(result.organizationId).toBe(fake.organizations[0]!.id);
    expect(result.email).toBe("ana@brobond.ai");
  });

  it("returns the workspace name for the post-signup UI", async () => {
    const result = await service.register(PAYLOAD);
    expect(result.workspaceName).toBe("Brobond Commerce");
  });
});

// ------------------------------------------------------------------
// §4 — the first user is ADMIN
// ------------------------------------------------------------------

describe("register() — the first user is ADMIN", () => {
  it("assigns the ADMIN role", async () => {
    await service.register(PAYLOAD);
    expect(fake.users[0]!.role).toBe(UserRole.ADMIN);
  });

  it("returns ADMIN to the caller", async () => {
    const result = await service.register(PAYLOAD);
    expect(result.role).toBe(UserRole.ADMIN);
  });

  it("assigns ADMIN even when the payload begs for MEMBER", async () => {
    // There is no `role` field in the schema, but a hand-rolled caller could
    // still pass one. The service must ignore it.
    await service.register({ ...PAYLOAD, role: "MEMBER" } as never);
    expect(fake.users[0]!.role).toBe(UserRole.ADMIN);
  });

  it("binds the user to the organization it just created", async () => {
    await service.register(PAYLOAD);
    expect(fake.users[0]!.organizationId).toBe(fake.organizations[0]!.id);
  });

  it("never creates a user without a tenant", async () => {
    await service.register(PAYLOAD);
    for (const user of fake.users) {
      expect(user.organizationId).toBeTruthy();
    }
  });

  it("ignores an organizationId smuggled into the payload", async () => {
    await service.register({ ...PAYLOAD, organizationId: "org_victim" } as never);
    expect(fake.users[0]!.organizationId).toBe(fake.organizations[0]!.id);
    expect(fake.users[0]!.organizationId).not.toBe("org_victim");
  });
});

// ------------------------------------------------------------------
// §4 — password handling
// ------------------------------------------------------------------

describe("register() — password handling", () => {
  it("stores a bcrypt hash, never the plaintext", async () => {
    await service.register(PAYLOAD);
    expect(fake.users[0]!.passwordHash).toBe("bcrypt$senha-super-secreta");
  });

  it("never stores a column equal to the plaintext password", async () => {
    await service.register(PAYLOAD);
    for (const value of Object.values(fake.users[0]!)) {
      expect(value).not.toBe(PAYLOAD.password);
    }
  });

  it("never returns the hash to the caller", async () => {
    const result = await service.register(PAYLOAD);
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("never writes the password onto the Organization", async () => {
    await service.register(PAYLOAD);
    const serialized = JSON.stringify(fake.organizations[0]);
    expect(serialized).not.toContain(PAYLOAD.password);
  });

  it("normalizes the email to lowercase before storing it", async () => {
    await service.register({ ...PAYLOAD, email: "Ana@Brobond.AI" });
    expect(fake.users[0]!.email).toBe("ana@brobond.ai");
  });
});

// ------------------------------------------------------------------
// §8 — duplicate email
// ------------------------------------------------------------------

describe("register() — duplicate email", () => {
  it("refuses a second signup with the same email", async () => {
    await service.register(PAYLOAD);
    await expect(service.register(PAYLOAD)).rejects.toBeInstanceOf(SignupError);
  });

  it("refuses it with the EMAIL_TAKEN code", async () => {
    await service.register(PAYLOAD);
    await expect(service.register(PAYLOAD)).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("attributes the error to the `email` FIELD (§8)", async () => {
    await service.register(PAYLOAD);
    await expect(service.register(PAYLOAD)).rejects.toMatchObject({ field: "email" });
  });

  it("uses a message that names the actual problem", async () => {
    await service.register(PAYLOAD);
    await expect(service.register(PAYLOAD)).rejects.toThrow(/já está sendo utilizado/i);
  });

  it("never says only 'Revise os campos destacados'", async () => {
    await service.register(PAYLOAD);
    await expect(service.register(PAYLOAD)).rejects.not.toThrow(/^Revise os campos/);
  });

  it("treats a differently-cased email as the same account", async () => {
    await service.register(PAYLOAD);
    await expect(service.register({ ...PAYLOAD, email: "ANA@BROBOND.AI" })).rejects.toBeInstanceOf(
      SignupError,
    );
  });

  it("creates NO second organization when the email is taken", async () => {
    await service.register(PAYLOAD);
    await service.register(PAYLOAD).catch(() => undefined);
    expect(fake.organizations).toHaveLength(1);
  });

  it("creates NO second user when the email is taken", async () => {
    await service.register(PAYLOAD);
    await service.register(PAYLOAD).catch(() => undefined);
    expect(fake.users).toHaveLength(1);
  });

  it("seeds NO second batch of templates when the email is taken", async () => {
    await service.register(PAYLOAD);
    await service.register(PAYLOAD).catch(() => undefined);
    expect(fake.messageTemplates).toHaveLength(OUTREACH_TEMPLATES.length);
  });
});

// ------------------------------------------------------------------
// Slug collisions — two companies with the same name
// ------------------------------------------------------------------

describe("register() — slug collisions", () => {
  it("gives the second company of the same name a distinct slug", async () => {
    await service.register(PAYLOAD);
    await service.register({ ...PAYLOAD, email: "bruno@outra.com" });

    expect(fake.organizations[0]!.slug).toBe("brobond-commerce");
    expect(fake.organizations[1]!.slug).toBe("brobond-commerce-2");
  });

  it("keeps going past the second collision", async () => {
    await service.register(PAYLOAD);
    await service.register({ ...PAYLOAD, email: "b@x.com" });
    await service.register({ ...PAYLOAD, email: "c@x.com" });

    expect(fake.organizations.map((org) => org.slug)).toEqual([
      "brobond-commerce",
      "brobond-commerce-2",
      "brobond-commerce-3",
    ]);
  });

  it("never issues the same slug twice", async () => {
    await service.register(PAYLOAD);
    await service.register({ ...PAYLOAD, email: "b@x.com" });
    await service.register({ ...PAYLOAD, email: "c@x.com" });

    const slugs = fake.organizations.map((org) => org.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("folds accents rather than mangling them", async () => {
    await service.register({ ...PAYLOAD, company: "Café Belíssimo" });
    expect(fake.organizations[0]!.slug).toBe("cafe-belissimo");
  });

  it("falls back for a company with nothing sluggable", async () => {
    await service.register({ ...PAYLOAD, company: "&&&" });
    expect(fake.organizations[0]!.slug).toBe("workspace");
  });
});

// ------------------------------------------------------------------
// §5 — Google first access
// ------------------------------------------------------------------

describe("ensureFederatedTenant() — first access (§5)", () => {
  const PROFILE = { email: "carla@empresa.com.br", name: "Carla Souza", image: null };

  it("creates a tenant for an unknown Google user", async () => {
    const { created } = await service.ensureFederatedTenant(PROFILE);
    expect(created).toBe(true);
    expect(fake.organizations).toHaveLength(1);
  });

  it("creates the user as ADMIN", async () => {
    await service.ensureFederatedTenant(PROFILE);
    expect(fake.users[0]!.role).toBe(UserRole.ADMIN);
  });

  it("creates the user WITHOUT a password hash", async () => {
    await service.ensureFederatedTenant(PROFILE);
    expect(fake.users[0]!.passwordHash).toBeNull();
  });

  it("binds the user to the new tenant", async () => {
    const { result } = await service.ensureFederatedTenant(PROFILE);
    expect(fake.users[0]!.organizationId).toBe(result.organizationId);
  });

  it("seeds the workspace exactly like a credentials signup", async () => {
    await service.ensureFederatedTenant(PROFILE);
    expect(fake.messageTemplates).toHaveLength(OUTREACH_TEMPLATES.length);
  });

  it("applies the same workspace defaults", async () => {
    await service.ensureFederatedTenant(PROFILE);
    expect(fake.organizations[0]!.currency).toBe("BRL");
    expect(fake.organizations[0]!.locale).toBe("pt-BR");
  });

  it("stores no phone number — Google never asked for one", async () => {
    await service.ensureFederatedTenant(PROFILE);
    expect(fake.organizations[0]!.whatsapp).toBeNull();
  });

  it("infers a company name from a corporate email domain", async () => {
    await service.ensureFederatedTenant(PROFILE);
    expect(fake.organizations[0]!.name).toBe("Empresa");
  });

  it("falls back to the person's name for a free-mail domain", async () => {
    await service.ensureFederatedTenant({ email: "carla@gmail.com", name: "Carla Souza" });
    expect(fake.organizations[0]!.name).toBe("Workspace de Carla Souza");
  });

  it("derives a display name when Google returns none", async () => {
    await service.ensureFederatedTenant({ email: "joao.silva@gmail.com", name: null });
    expect(fake.users[0]!.name).toBe("Joao Silva");
  });

  it("lowercases the email", async () => {
    await service.ensureFederatedTenant({ ...PROFILE, email: "CARLA@Empresa.com.BR" });
    expect(fake.users[0]!.email).toBe("carla@empresa.com.br");
  });

  it("stores the Google profile picture", async () => {
    await service.ensureFederatedTenant({ ...PROFILE, image: "https://cdn/avatar.png" });
    expect(fake.users[0]!.image).toBe("https://cdn/avatar.png");
  });
});

describe("ensureFederatedTenant() — returning user (§5: 'entrar normalmente')", () => {
  const PROFILE = { email: "ana@brobond.ai", name: "Ana Ribeiro", image: null };

  it("does NOT create a second organization", async () => {
    await service.register(PAYLOAD);
    await service.ensureFederatedTenant(PROFILE);
    expect(fake.organizations).toHaveLength(1);
  });

  it("does NOT create a second user", async () => {
    await service.register(PAYLOAD);
    await service.ensureFederatedTenant(PROFILE);
    expect(fake.users).toHaveLength(1);
  });

  it("reports `created: false`", async () => {
    await service.register(PAYLOAD);
    const { created } = await service.ensureFederatedTenant(PROFILE);
    expect(created).toBe(false);
  });

  it("returns the EXISTING tenant, not a new one", async () => {
    const first = await service.register(PAYLOAD);
    const { result } = await service.ensureFederatedTenant(PROFILE);
    expect(result.organizationId).toBe(first.organizationId);
  });

  it("returns the existing user id", async () => {
    const first = await service.register(PAYLOAD);
    const { result } = await service.ensureFederatedTenant(PROFILE);
    expect(result.userId).toBe(first.userId);
  });

  it("does NOT re-seed the workspace", async () => {
    await service.register(PAYLOAD);
    await service.ensureFederatedTenant(PROFILE);
    expect(fake.messageTemplates).toHaveLength(OUTREACH_TEMPLATES.length);
  });

  it("does NOT re-elevate an existing MEMBER to ADMIN", async () => {
    await service.register(PAYLOAD);
    fake.users[0]!.role = UserRole.MEMBER;

    const { result } = await service.ensureFederatedTenant(PROFILE);
    expect(result.role).toBe(UserRole.MEMBER);
    expect(fake.users[0]!.role).toBe(UserRole.MEMBER);
  });

  it("does NOT re-elevate an existing MANAGER to ADMIN", async () => {
    await service.register(PAYLOAD);
    fake.users[0]!.role = UserRole.MANAGER;

    const { result } = await service.ensureFederatedTenant(PROFILE);
    expect(result.role).toBe(UserRole.MANAGER);
  });

  it("matches a differently-cased email to the same account", async () => {
    const first = await service.register(PAYLOAD);
    const { result, created } = await service.ensureFederatedTenant({
      ...PROFILE,
      email: "ANA@BROBOND.AI",
    });
    expect(created).toBe(false);
    expect(result.userId).toBe(first.userId);
  });

  it("returns the workspace name of the existing tenant", async () => {
    await service.register(PAYLOAD);
    const { result } = await service.ensureFederatedTenant(PROFILE);
    expect(result.workspaceName).toBe("Brobond Commerce");
  });
});

// ------------------------------------------------------------------
// provision() — the shared primitive
// ------------------------------------------------------------------

describe("provision() — shared by both signup routes", () => {
  it("is exposed so the adapter can reuse it", () => {
    expect(typeof service.provision).toBe("function");
  });

  it("produces an identical tenant shape for both routes", async () => {
    await service.register(PAYLOAD);
    const credentialsOrg = { ...fake.organizations[0] } as Row;

    fake = makeDb();
    service = createSignupService(fake.db as never);
    await service.ensureFederatedTenant({ email: "ana@brobond.ai", name: "Ana Ribeiro" });
    const federatedOrg = fake.organizations[0] as Row;

    expect(Object.keys(federatedOrg).sort()).toEqual(Object.keys(credentialsOrg).sort());
  });

  it("refuses a duplicate email regardless of route", async () => {
    await service.register(PAYLOAD);
    await expect(
      service.provision({
        email: PAYLOAD.email,
        name: "Outra Pessoa",
        company: "Outra Empresa",
        whatsapp: null,
        passwordHash: null,
      }),
    ).rejects.toBeInstanceOf(SignupError);
  });

  it("seedWorkspace() is exposed and scoped to one tenant", async () => {
    await service.seedWorkspace(fake.db as never, "org_manual");
    expect(fake.messageTemplates.every((row) => row.organizationId === "org_manual")).toBe(true);
  });
});
