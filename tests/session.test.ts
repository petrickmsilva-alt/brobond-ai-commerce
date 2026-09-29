import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";

/**
 * Session-aware guards (`lib/session.ts`).
 *
 * `lib/auth.ts` is mocked so these tests exercise the guard logic without
 * NextAuth, Prisma or a database.
 */
const authMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: authMock }));

type SessionUser = {
  id?: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  role?: UserRole;
  organizationId?: string | null;
};

function mockSession(user: SessionUser | null) {
  authMock.mockResolvedValue(user ? { user } : null);
}

const ORG_A = "org_aaaaaaaaaaaaaaaaaaaa";

const {
  getCurrentUser,
  getCurrentOrganization,
  requireUser,
  requireOrganization,
  requireRole,
  requireAdmin,
  requireManager,
} = await import("@/lib/session");

beforeEach(() => {
  authMock.mockReset();
});

describe("getCurrentUser()", () => {
  it("returns null when there is no session", async () => {
    mockSession(null);
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null when the session has no user id", async () => {
    mockSession({ email: "ghost@brobond.ai" });
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("maps the session user, defaulting the role to MEMBER", async () => {
    mockSession({ id: "u1", email: "a@brobond.ai", organizationId: ORG_A });
    await expect(getCurrentUser()).resolves.toEqual({
      id: "u1",
      email: "a@brobond.ai",
      name: null,
      image: null,
      role: UserRole.MEMBER,
      organizationId: ORG_A,
    });
  });

  it("never exposes secret material (no passwordHash / secrets on the object)", async () => {
    mockSession({ id: "u1", email: "a@brobond.ai", role: UserRole.ADMIN, organizationId: ORG_A });
    const user = await getCurrentUser();
    expect(Object.keys(user ?? {}).sort()).toEqual([
      "email",
      "id",
      "image",
      "name",
      "organizationId",
      "role",
    ]);
  });
});

describe("getCurrentOrganization()", () => {
  it("returns the tenant id from the session", async () => {
    mockSession({ id: "u1", role: UserRole.MEMBER, organizationId: ORG_A });
    await expect(getCurrentOrganization()).resolves.toBe(ORG_A);
  });

  it("returns null when unauthenticated", async () => {
    mockSession(null);
    await expect(getCurrentOrganization()).resolves.toBeNull();
  });

  it("returns null when the session carries no tenant", async () => {
    mockSession({ id: "u1", role: UserRole.ADMIN, organizationId: null });
    await expect(getCurrentOrganization()).resolves.toBeNull();
  });
});

describe("requireUser()", () => {
  it("throws 401 when unauthenticated", async () => {
    mockSession(null);
    await expect(requireUser()).rejects.toThrowError(AuthorizationError);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });

  it("returns the user when authenticated", async () => {
    mockSession({ id: "u1", role: UserRole.MEMBER, organizationId: ORG_A });
    await expect(requireUser()).resolves.toMatchObject({ id: "u1" });
  });
});

describe("requireOrganization()", () => {
  it("returns the tenant id for a tenant-bound session", async () => {
    mockSession({ id: "u1", role: UserRole.MEMBER, organizationId: ORG_A });
    await expect(requireOrganization()).resolves.toBe(ORG_A);
  });

  it("throws 401 when unauthenticated", async () => {
    mockSession(null);
    await expect(requireOrganization()).rejects.toMatchObject({ status: 401 });
  });

  it("throws 403 when the session has no organization", async () => {
    mockSession({ id: "u1", role: UserRole.ADMIN, organizationId: null });
    await expect(requireOrganization()).rejects.toMatchObject({ status: 403 });
  });
});

describe("requireRole()", () => {
  it("allows a role that meets the requirement", async () => {
    mockSession({ id: "u1", role: UserRole.MANAGER, organizationId: ORG_A });
    await expect(requireRole(UserRole.MANAGER)).resolves.toMatchObject({
      id: "u1",
      role: UserRole.MANAGER,
      organizationId: ORG_A,
    });
  });

  it("allows a higher role (ADMIN satisfies MANAGER)", async () => {
    mockSession({ id: "u1", role: UserRole.ADMIN, organizationId: ORG_A });
    await expect(requireRole(UserRole.MANAGER)).resolves.toMatchObject({ role: UserRole.ADMIN });
  });

  it("throws 403 for an insufficient role", async () => {
    mockSession({ id: "u1", role: UserRole.MEMBER, organizationId: ORG_A });
    await expect(requireRole(UserRole.ADMIN)).rejects.toMatchObject({ status: 403 });
  });

  it("throws 401 when unauthenticated", async () => {
    mockSession(null);
    await expect(requireRole(UserRole.MEMBER)).rejects.toMatchObject({ status: 401 });
  });

  it("throws 403 when the role passes but the session has no tenant", async () => {
    mockSession({ id: "u1", role: UserRole.ADMIN, organizationId: null });
    await expect(requireRole(UserRole.ADMIN)).rejects.toMatchObject({ status: 403 });
  });

  it("always returns a non-null organizationId on success", async () => {
    mockSession({ id: "u1", role: UserRole.ADMIN, organizationId: ORG_A });
    const user = await requireRole(UserRole.MEMBER);
    expect(user.organizationId).toBe(ORG_A);
  });
});

describe("requireAdmin() / requireManager()", () => {
  it("requireAdmin allows ADMIN only", async () => {
    mockSession({ id: "u1", role: UserRole.ADMIN, organizationId: ORG_A });
    await expect(requireAdmin()).resolves.toMatchObject({ role: UserRole.ADMIN });

    mockSession({ id: "u2", role: UserRole.MANAGER, organizationId: ORG_A });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });

    mockSession({ id: "u3", role: UserRole.MEMBER, organizationId: ORG_A });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("requireManager allows MANAGER and ADMIN, denies MEMBER", async () => {
    mockSession({ id: "u1", role: UserRole.ADMIN, organizationId: ORG_A });
    await expect(requireManager()).resolves.toMatchObject({ role: UserRole.ADMIN });

    mockSession({ id: "u2", role: UserRole.MANAGER, organizationId: ORG_A });
    await expect(requireManager()).resolves.toMatchObject({ role: UserRole.MANAGER });

    mockSession({ id: "u3", role: UserRole.MEMBER, organizationId: ORG_A });
    await expect(requireManager()).rejects.toMatchObject({ status: 403 });
  });
});
