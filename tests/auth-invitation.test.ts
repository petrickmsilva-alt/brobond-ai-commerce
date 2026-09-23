import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import { hashToken, invitationExpiry } from "@/lib/tokens";

/**
 * PR010.2 §7 — invitation flow, against an in-memory fake Prisma.
 *
 * The service is built through `createInvitationService(db)` exactly as
 * production does — only the database is faked — so these tests exercise the
 * real security contract:
 *
 *   1. only the token DIGEST is persisted;
 *   2. an invitation is single-use (a replay cannot create a second account);
 *   3. role and tenant come from the invitation, never from the payload;
 *   4. expired / revoked / unknown tokens are rejected with typed reasons;
 *   5. ADMIN reads and revokes are tenant-scoped.
 *
 * `@/lib/prisma` is mocked so importing the module never instantiates a real
 * client, and bcrypt is stubbed to keep the suite fast and deterministic.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
}));

const { createInvitationService, InvitationError } = await import(
  "@/modules/auth/invitation.service"
);

const ORG_A = "org_tenant_a";
const ORG_B = "org_tenant_b";
const ADMIN_ID = "user_admin";

type Row = Record<string, unknown>;

/** Minimal in-memory Prisma double covering the calls the service makes. */
function makeDb() {
  const invitations: Row[] = [];
  const users: Row[] = [];
  const organizations: Row[] = [
    { id: ORG_A, name: "Tenant A" },
    { id: ORG_B, name: "Tenant B" },
  ];
  let sequence = 0;

  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => row[key] === value);
  }

  const db = {
    invitation: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        return invitations.find((row) => matches(row, where)) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        return invitations.find((row) => matches(row, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: Row }) => {
        return invitations.filter((row) => matches(row, where ?? {}));
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        sequence += 1;
        const row = {
          id: `inv_${sequence}`,
          acceptedAt: null,
          createdAt: new Date(),
          ...data,
        };
        invitations.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = invitations.find((item) => matches(item, where));
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = invitations.filter((item) => matches(item, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        return users.find((row) => matches(row, where)) ?? null;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const existing = users.find((row) => matches(row, where));
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        sequence += 1;
        const row = { id: `user_${sequence}`, ...create };
        users.push(row);
        return row;
      }),
    },
    organization: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        return organizations.find((row) => matches(row, where)) ?? null;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };

  return { db, invitations, users };
}

let fake: ReturnType<typeof makeDb>;
let service: ReturnType<typeof createInvitationService>;

beforeEach(() => {
  fake = makeDb();
  service = createInvitationService(fake.db as never);
});

describe("create()", () => {
  it("returns the raw token and stores ONLY its digest", async () => {
    const { token, invitation } = await service.create(ORG_A, {
      email: "ana@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

    const stored = fake.invitations[0] as Row;
    expect(stored.tokenHash).toBe(hashToken(token));
    // The raw token must not appear anywhere in the persisted row.
    expect(JSON.stringify(stored)).not.toContain(token);
    // …nor in the view returned to the ADMIN table.
    expect(JSON.stringify(invitation)).not.toContain(token);
  });

  it("binds the invitation to the calling tenant", async () => {
    await service.create(ORG_A, {
      email: "ana@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    expect(fake.invitations[0]?.organizationId).toBe(ORG_A);
  });

  it("normalizes the email to lowercase", async () => {
    await service.create(ORG_A, {
      email: "  Ana@Brobond.AI ",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    expect(fake.invitations[0]?.email).toBe("ana@brobond.ai");
  });

  it("rejects a blank tenant BEFORE touching the database", async () => {
    await expect(
      service.create("", { email: "a@b.ai", role: UserRole.MEMBER, invitedBy: ADMIN_ID }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(fake.db.invitation.create).not.toHaveBeenCalled();
  });

  it("refuses to invite an email that already has an account", async () => {
    fake.users.push({ id: "user_1", email: "existing@brobond.ai" });

    await expect(
      service.create(ORG_A, {
        email: "existing@brobond.ai",
        role: UserRole.MEMBER,
        invitedBy: ADMIN_ID,
      }),
    ).rejects.toBeInstanceOf(InvitationError);
  });

  it("rotates the token when re-inviting a pending email (old link dies)", async () => {
    const first = await service.create(ORG_A, {
      email: "ana@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    const second = await service.create(ORG_A, {
      email: "ana@brobond.ai",
      role: UserRole.MANAGER,
      invitedBy: ADMIN_ID,
    });

    expect(fake.invitations).toHaveLength(1);
    expect(second.token).not.toBe(first.token);
    expect(fake.invitations[0]?.tokenHash).toBe(hashToken(second.token));
    // The previous link no longer resolves.
    await expect(service.resolveToken(first.token)).rejects.toBeInstanceOf(InvitationError);
  });

  it("records the inviting ADMIN and the requested role", async () => {
    await service.create(ORG_A, {
      email: "ana@brobond.ai",
      role: UserRole.MANAGER,
      invitedBy: ADMIN_ID,
    });
    expect(fake.invitations[0]?.invitedBy).toBe(ADMIN_ID);
    expect(fake.invitations[0]?.role).toBe(UserRole.MANAGER);
  });
});

describe("resolveToken()", () => {
  async function issue() {
    const { token } = await service.create(ORG_A, {
      email: "ana@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    return token;
  }

  it("resolves a live token", async () => {
    const token = await issue();
    await expect(service.resolveToken(token)).resolves.toMatchObject({
      email: "ana@brobond.ai",
      organizationId: ORG_A,
    });
  });

  it("rejects an unknown token as not_found", async () => {
    await expect(service.resolveToken("totally-made-up")).rejects.toMatchObject({
      reason: "not_found",
    });
  });

  it("rejects an expired token", async () => {
    const token = await issue();
    const future = new Date(invitationExpiry(new Date()).getTime() + 60_000);
    await expect(service.resolveToken(token, future)).rejects.toMatchObject({
      reason: "expired",
    });
  });

  it("rejects a revoked token", async () => {
    const token = await issue();
    await service.revoke(ORG_A, fake.invitations[0]?.id as string);
    await expect(service.resolveToken(token)).rejects.toMatchObject({ reason: "revoked" });
  });

  it("rejects an already-accepted token", async () => {
    const token = await issue();
    await service.accept(token, { password: "super-secret-1" });
    await expect(service.resolveToken(token)).rejects.toMatchObject({ reason: "accepted" });
  });
});

describe("accept() — the only path that creates a user", () => {
  async function issue(role: UserRole = UserRole.MEMBER, org = ORG_A) {
    const { token } = await service.create(org, {
      email: "ana@brobond.ai",
      name: "Ana",
      role,
      invitedBy: ADMIN_ID,
    });
    return token;
  }

  it("creates the user with the invitation's role and tenant", async () => {
    const token = await issue(UserRole.MANAGER, ORG_B);
    const result = await service.accept(token, { password: "super-secret-1" });

    expect(result.role).toBe(UserRole.MANAGER);
    expect(result.organizationId).toBe(ORG_B);
    expect(result.email).toBe("ana@brobond.ai");
  });

  it("stores a HASH of the chosen password, never the plaintext", async () => {
    const token = await issue();
    await service.accept(token, { password: "super-secret-1" });

    const user = fake.users[0] as Row;
    expect(user.passwordHash).toBe("hashed:super-secret-1");
    expect(JSON.stringify(user)).not.toContain('"super-secret-1"');
  });

  it("marks the invitation ACCEPTED with a timestamp", async () => {
    const token = await issue();
    await service.accept(token, { password: "super-secret-1" });

    expect(fake.invitations[0]?.status).toBe("ACCEPTED");
    expect(fake.invitations[0]?.acceptedAt).toBeInstanceOf(Date);
  });

  it("is SINGLE USE — a replayed link cannot create a second account", async () => {
    const token = await issue();
    await service.accept(token, { password: "super-secret-1" });

    await expect(service.accept(token, { password: "another-one-2" })).rejects.toBeInstanceOf(
      InvitationError,
    );
    expect(fake.users).toHaveLength(1);
  });

  it("cannot be used to escalate a role — the payload carries none", async () => {
    const token = await issue(UserRole.MEMBER);
    // Even if a caller smuggles extra fields, the service reads the stored row.
    const result = await service.accept(token, {
      password: "super-secret-1",
      ...({ role: UserRole.ADMIN, organizationId: ORG_B } as object),
    } as never);

    expect(result.role).toBe(UserRole.MEMBER);
    expect(result.organizationId).toBe(ORG_A);
  });

  it("refuses an expired invitation", async () => {
    const token = await issue();
    const future = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await expect(
      service.accept(token, { password: "super-secret-1" }, future),
    ).rejects.toMatchObject({ reason: "expired" });
    expect(fake.users).toHaveLength(0);
  });

  it("uses the invitation's name when the invitee supplies none", async () => {
    const token = await issue();
    await service.accept(token, { password: "super-secret-1" });
    expect(fake.users[0]?.name).toBe("Ana");
  });
});

describe("list() / revoke() — tenant scoping", () => {
  it("never returns another tenant's invitations", async () => {
    await service.create(ORG_A, {
      email: "a@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    await service.create(ORG_B, {
      email: "b@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });

    const listA = await service.list(ORG_A);
    expect(listA).toHaveLength(1);
    expect(listA[0]?.email).toBe("a@brobond.ai");
  });

  it("never leaks a token or digest in the list payload", async () => {
    await service.create(ORG_A, {
      email: "a@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    const serialized = JSON.stringify(await service.list(ORG_A));
    expect(serialized).not.toContain("tokenHash");
  });

  it("refuses to revoke an invitation belonging to another tenant", async () => {
    await service.create(ORG_A, {
      email: "a@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    const id = fake.invitations[0]?.id as string;

    // ORG_B tries to revoke ORG_A's invitation.
    await expect(service.revoke(ORG_B, id)).resolves.toBe(false);
    expect(fake.invitations[0]?.status).toBe("PENDING");
  });

  it("revokes a pending invitation within the tenant", async () => {
    await service.create(ORG_A, {
      email: "a@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    const id = fake.invitations[0]?.id as string;

    await expect(service.revoke(ORG_A, id)).resolves.toBe(true);
    expect(fake.invitations[0]?.status).toBe("REVOKED");
  });

  it("will not revoke an already-accepted invitation", async () => {
    const { token } = await service.create(ORG_A, {
      email: "a@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    await service.accept(token, { password: "super-secret-1" });

    await expect(
      service.revoke(ORG_A, fake.invitations[0]?.id as string),
    ).resolves.toBe(false);
  });

  it("rejects a blank tenant before querying", async () => {
    await expect(service.list("")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("flags a pending-but-stale invitation as expired in the view", async () => {
    await service.create(ORG_A, {
      email: "a@brobond.ai",
      role: UserRole.MEMBER,
      invitedBy: ADMIN_ID,
    });
    const future = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const [view] = await service.list(ORG_A, future);
    expect(view?.expired).toBe(true);
  });
});

describe("preview()", () => {
  it("exposes the workspace and role without any secret", async () => {
    const { token } = await service.create(ORG_A, {
      email: "ana@brobond.ai",
      role: UserRole.MANAGER,
      invitedBy: ADMIN_ID,
    });

    const preview = await service.preview(token);
    expect(preview).toMatchObject({
      email: "ana@brobond.ai",
      role: UserRole.MANAGER,
      organizationName: "Tenant A",
    });
    expect(JSON.stringify(preview)).not.toContain(token);
    expect(JSON.stringify(preview)).not.toContain("tokenHash");
  });

  it("throws for an invalid token", async () => {
    await expect(service.preview("nope")).rejects.toBeInstanceOf(InvitationError);
  });
});
