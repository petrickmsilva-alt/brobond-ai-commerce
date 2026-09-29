import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR010.4 §5 — Google first access.
 *
 * "Se usuário não existir: criar automaticamente Organization + User ADMIN +
 * Workspace. Se existir: entrar normalmente."
 *
 * WHY THE ADAPTER AND NOT THE `signIn` CALLBACK
 * ---------------------------------------------
 * `signIn` runs before NextAuth's `handleLoginOrRegister`. Provisioning there
 * would leave the adapter's `getUserByEmail` finding an account with no linked
 * OAuth record, and NextAuth would correctly abort with `AccountNotLinked`.
 * Creating the user at the exact moment NextAuth asks for one keeps the
 * library's own linking logic intact — which is the "não quebrar NextAuth"
 * requirement of this PR, tested here.
 */

const ensureFederatedTenantMock = vi.hoisted(() => vi.fn());
const prismaAdapterMock = vi.hoisted(() =>
  vi.fn(() => ({
    createUser: vi.fn(),
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByAccount: vi.fn(),
    updateUser: vi.fn(),
    linkAccount: vi.fn(),
    createSession: vi.fn(),
    getSessionAndUser: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
  })),
);

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: prismaAdapterMock }));
vi.mock("@/modules/auth/signup.service", () => ({
  signupService: { ensureFederatedTenant: ensureFederatedTenantMock },
}));

const { createTenantAwareAdapter } = await import("@/lib/auth-adapter");

const PROVISIONED = {
  userId: "user_new",
  email: "carla@empresa.com.br",
  name: "Carla Souza",
  role: "ADMIN",
  organizationId: "org_new",
  organizationSlug: "empresa",
  workspaceName: "Empresa",
};

beforeEach(() => {
  ensureFederatedTenantMock.mockReset().mockResolvedValue({ result: PROVISIONED, created: true });
  prismaAdapterMock.mockClear();
});

// ------------------------------------------------------------------
// The adapter wraps, it does not replace
// ------------------------------------------------------------------

describe("createTenantAwareAdapter() — NextAuth is configured, not bypassed", () => {
  it("builds on the stock Prisma adapter", () => {
    createTenantAwareAdapter();
    expect(prismaAdapterMock).toHaveBeenCalledTimes(1);
  });

  it("overrides ONLY createUser", () => {
    const adapter = createTenantAwareAdapter();
    const results = prismaAdapterMock.mock.results;
    const stock = results[results.length - 1]!.value as Record<string, unknown>;

    for (const method of [
      "getUser",
      "getUserByEmail",
      "getUserByAccount",
      "updateUser",
      "linkAccount",
      "createSession",
      "getSessionAndUser",
      "deleteSession",
    ]) {
      expect((adapter as Record<string, unknown>)[method], method).toBe(stock[method]);
    }
  });

  it("replaces createUser with its own implementation", () => {
    const adapter = createTenantAwareAdapter();
    const results = prismaAdapterMock.mock.results;
    const stock = results[results.length - 1]!.value as Record<string, unknown>;

    expect(adapter.createUser).not.toBe(stock.createUser);
  });

  it("keeps getUserByEmail intact — that is how a RETURNING user is resolved", () => {
    const adapter = createTenantAwareAdapter();
    expect(typeof adapter.getUserByEmail).toBe("function");
  });

  it("keeps linkAccount intact — that is how the OAuth record is attached", () => {
    const adapter = createTenantAwareAdapter();
    expect(typeof adapter.linkAccount).toBe("function");
  });
});

// ------------------------------------------------------------------
// createUser — first access provisions a tenant
// ------------------------------------------------------------------

describe("createUser() — first access (§5)", () => {
  it("provisions a tenant instead of writing a bare user", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "ignored",
      email: "carla@empresa.com.br",
      name: "Carla Souza",
      emailVerified: null,
    } as never);

    expect(ensureFederatedTenantMock).toHaveBeenCalledTimes(1);
  });

  it("passes the Google email through", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla Souza",
      emailVerified: null,
    } as never);

    expect(ensureFederatedTenantMock.mock.calls[0]![0].email).toBe("carla@empresa.com.br");
  });

  it("lowercases the email before provisioning", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "CARLA@Empresa.COM.BR",
      name: "Carla",
      emailVerified: null,
    } as never);

    expect(ensureFederatedTenantMock.mock.calls[0]![0].email).toBe("carla@empresa.com.br");
  });

  it("trims a padded email", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "  carla@empresa.com.br  ",
      name: "Carla",
      emailVerified: null,
    } as never);

    expect(ensureFederatedTenantMock.mock.calls[0]![0].email).toBe("carla@empresa.com.br");
  });

  it("passes the Google display name", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla Souza",
      emailVerified: null,
    } as never);

    expect(ensureFederatedTenantMock.mock.calls[0]![0].name).toBe("Carla Souza");
  });

  it("tolerates a Google profile with no name", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: null,
      emailVerified: null,
    } as never);

    expect(ensureFederatedTenantMock.mock.calls[0]![0].name).toBeNull();
  });

  it("passes the Google avatar", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      image: "https://cdn/a.png",
      emailVerified: null,
    } as never);

    expect(ensureFederatedTenantMock.mock.calls[0]![0].image).toBe("https://cdn/a.png");
  });

  it("returns the id of the user the service created", async () => {
    const adapter = createTenantAwareAdapter();
    const user = await adapter.createUser!({
      id: "nextauth-generated-id",
      email: "carla@empresa.com.br",
      name: "Carla",
      emailVerified: null,
    } as never);

    // NextAuth's generated id is discarded — the database's cuid wins.
    expect(user.id).toBe("user_new");
  });

  it("returns the provisioned email", async () => {
    const adapter = createTenantAwareAdapter();
    const user = await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      emailVerified: null,
    } as never);

    expect(user.email).toBe("carla@empresa.com.br");
  });

  it("marks the email verified — Google already did that work", async () => {
    const adapter = createTenantAwareAdapter();
    const user = await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      emailVerified: null,
    } as never);

    expect(user.emailVerified).toBeInstanceOf(Date);
  });

  it("preserves an emailVerified date the provider supplied", async () => {
    const supplied = new Date("2026-01-01T00:00:00.000Z");
    const adapter = createTenantAwareAdapter();
    const user = await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      emailVerified: supplied,
    } as never);

    expect(user.emailVerified).toBe(supplied);
  });

  it("returns no passwordHash — federated accounts have none", async () => {
    const adapter = createTenantAwareAdapter();
    const user = await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      emailVerified: null,
    } as never);

    expect(user).not.toHaveProperty("passwordHash");
  });

  it("returns no organizationId on the AdapterUser — the JWT callback resolves it", async () => {
    const adapter = createTenantAwareAdapter();
    const user = await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      emailVerified: null,
    } as never);

    expect(user).not.toHaveProperty("organizationId");
  });
});

// ------------------------------------------------------------------
// createUser — refusals
// ------------------------------------------------------------------

describe("createUser() — an identity with no email", () => {
  it("is refused", async () => {
    const adapter = createTenantAwareAdapter();
    await expect(
      adapter.createUser!({ id: "x", email: "", name: "Ghost", emailVerified: null } as never),
    ).rejects.toThrow(/requires an email/i);
  });

  it("is refused when the email is undefined", async () => {
    const adapter = createTenantAwareAdapter();
    await expect(
      adapter.createUser!({ id: "x", name: "Ghost", emailVerified: null } as never),
    ).rejects.toThrow(/requires an email/i);
  });

  it("is refused when the email is only whitespace", async () => {
    const adapter = createTenantAwareAdapter();
    await expect(
      adapter.createUser!({ id: "x", email: "   ", name: "G", emailVerified: null } as never),
    ).rejects.toThrow(/requires an email/i);
  });

  it("provisions nothing when refused", async () => {
    const adapter = createTenantAwareAdapter();
    await Promise.resolve(
      adapter.createUser!({ id: "x", email: "", name: "G", emailVerified: null } as never),
    ).catch(() => undefined);

    expect(ensureFederatedTenantMock).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// §5 — a returning Google user
// ------------------------------------------------------------------

describe("a returning Google user — 'entrar normalmente'", () => {
  it("never reaches createUser: NextAuth resolves them via getUserByEmail", () => {
    // This is a structural guarantee, asserted on the shape of the adapter:
    // `getUserByEmail` is the stock implementation, so an existing account is
    // found before `createUser` is ever consulted.
    const adapter = createTenantAwareAdapter();
    const results = prismaAdapterMock.mock.results;
    const stock = results[results.length - 1]!.value as Record<string, unknown>;

    expect(adapter.getUserByEmail).toBe(stock.getUserByEmail);
  });

  it("is signed into their EXISTING tenant when the service is reached anyway", async () => {
    ensureFederatedTenantMock.mockResolvedValue({
      created: false,
      result: { ...PROVISIONED, userId: "user_existing", organizationId: "org_existing" },
    });

    const adapter = createTenantAwareAdapter();
    const user = await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      emailVerified: null,
    } as never);

    expect(user.id).toBe("user_existing");
  });

  it("keeps their existing role — logging in never elevates anyone", async () => {
    ensureFederatedTenantMock.mockResolvedValue({
      created: false,
      result: { ...PROVISIONED, role: "MEMBER" },
    });

    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      emailVerified: null,
    } as never);

    // The adapter reports the user; it never writes a role of its own.
    expect(ensureFederatedTenantMock.mock.calls[0]![0]).not.toHaveProperty("role");
  });
});

// ------------------------------------------------------------------
// Security surface
// ------------------------------------------------------------------

describe("the adapter carries no secret", () => {
  it("never receives or forwards a role", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      role: "ADMIN",
      emailVerified: null,
    } as never);

    expect(ensureFederatedTenantMock.mock.calls[0]![0]).not.toHaveProperty("role");
  });

  it("never forwards an organizationId supplied by the provider payload", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      organizationId: "org_victim",
      emailVerified: null,
    } as never);

    expect(ensureFederatedTenantMock.mock.calls[0]![0]).not.toHaveProperty("organizationId");
  });

  it("forwards exactly three fields: email, name, image", async () => {
    const adapter = createTenantAwareAdapter();
    await adapter.createUser!({
      id: "x",
      email: "carla@empresa.com.br",
      name: "Carla",
      image: null,
      emailVerified: null,
    } as never);

    expect(Object.keys(ensureFederatedTenantMock.mock.calls[0]![0]).sort()).toEqual([
      "email",
      "image",
      "name",
    ]);
  });
});
