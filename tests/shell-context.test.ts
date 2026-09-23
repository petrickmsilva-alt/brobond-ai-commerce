import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR010.1 — App-shell context tests.
 *
 * `lib/shell-context.ts` is the boundary where server session state crosses
 * into a Client Component. These tests exist to keep that boundary honest:
 * only display metadata may cross, the tenant must scope every query, and no
 * credential may ever appear in the payload.
 */

// Explicit argument tuples so `mock.calls[0][0]` assertions type-check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = (args: any) => Promise<any>;

const requireUser = vi.fn<() => Promise<unknown>>();

const prismaMock = {
  organization: { findUnique: vi.fn<AnyArgs>(async () => ({ name: "Acme Commerce" })) },
  tikTokAccount: { count: vi.fn<AnyArgs>(async () => 0) },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/session", () => ({ requireUser: () => requireUser() }));

const { getShellContext } = await import("@/lib/shell-context");

const BASE_USER = {
  id: "u1",
  email: "ana@acme.com",
  name: "Ana Souza",
  image: null,
  role: "ADMIN",
  organizationId: "org_acme",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ ...BASE_USER });
  prismaMock.organization.findUnique.mockResolvedValue({ name: "Acme Commerce" });
  prismaMock.tikTokAccount.count.mockResolvedValue(0);
});

describe("shell context — presentation payload", () => {
  it("returns the user's display identity", async () => {
    const context = await getShellContext();

    expect(context.user.name).toBe("Ana Souza");
    expect(context.user.email).toBe("ana@acme.com");
    expect(context.user.role).toBe("ADMIN");
  });

  it("derives a display name from the email local part when the name is blank", async () => {
    requireUser.mockResolvedValue({ ...BASE_USER, name: "   " });
    const context = await getShellContext();
    expect(context.user.name).toBe("ana");
  });

  it("falls back to a generic label when there is neither name nor email", async () => {
    requireUser.mockResolvedValue({ ...BASE_USER, name: null, email: null });
    const context = await getShellContext();
    expect(context.user.name).toBe("Usuário");
    expect(context.user.email).toBe("—");
  });

  it("names the workspace after the organization", async () => {
    const context = await getShellContext();
    expect(context.workspace).toEqual({
      id: "org_acme",
      name: "Acme Commerce",
      caption: "Workspace",
    });
  });

  it("degrades gracefully for a session carrying no tenant", async () => {
    requireUser.mockResolvedValue({ ...BASE_USER, organizationId: null });

    const context = await getShellContext();

    expect(context.workspace.id).toBe("unknown");
    expect(context.tiktokStatus).toBe("disconnected");
    // No tenant → no tenant-scoped query may run at all.
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.tikTokAccount.count).not.toHaveBeenCalled();
  });
});

describe("shell context — tenant isolation", () => {
  it("scopes the organization lookup and the integration counts to the session tenant", async () => {
    await getShellContext();

    expect(prismaMock.organization.findUnique).toHaveBeenCalledWith({
      where: { id: "org_acme" },
      // PR010.4 — `workspaceName` joins the projection: a self-signup tenant
      // named its workspace, and the sidebar must show that name.
      select: { name: true, workspaceName: true },
    });
    for (const call of prismaMock.tikTokAccount.count.mock.calls) {
      expect(call[0].where.organizationId).toBe("org_acme");
    }
  });

  it("selects only display names — never a relation or a secret", async () => {
    await getShellContext();

    const select = prismaMock.organization.findUnique.mock.calls[0]![0].select;
    expect(Object.keys(select).sort()).toEqual(["name", "workspaceName"]);
  });

  it("never projects the tenant's contact or configuration columns", async () => {
    await getShellContext();

    const select = prismaMock.organization.findUnique.mock.calls[0]![0].select;
    for (const forbidden of ["whatsapp", "users", "invitations", "tikTokAccounts"]) {
      expect(select).not.toHaveProperty(forbidden);
    }
  });
});

describe("shell context — integration health", () => {
  it("reports `connected` when at least one account is CONNECTED", async () => {
    prismaMock.tikTokAccount.count.mockImplementation(async ({ where }) =>
      where.status === "CONNECTED" ? 1 : 1,
    );

    const context = await getShellContext();
    expect(context.tiktokStatus).toBe("connected");
  });

  it("reports `error` when accounts exist but none is connected", async () => {
    prismaMock.tikTokAccount.count.mockImplementation(async ({ where }) =>
      where.status === "CONNECTED" ? 0 : 2,
    );

    const context = await getShellContext();
    expect(context.tiktokStatus).toBe("error");
  });

  it("reports `disconnected` when the tenant has no TikTok account at all", async () => {
    prismaMock.tikTokAccount.count.mockResolvedValue(0);
    const context = await getShellContext();
    expect(context.tiktokStatus).toBe("disconnected");
  });

  it("counts accounts by status without ever selecting a token column", async () => {
    await getShellContext();

    for (const call of prismaMock.tikTokAccount.count.mock.calls) {
      const serialized = JSON.stringify(call[0]);
      expect(serialized).not.toMatch(/accessToken|refreshToken|select/i);
    }
  });
});

describe("shell context — no secret crosses the client boundary", () => {
  it("serializes to a payload free of credentials", async () => {
    requireUser.mockResolvedValue({
      ...BASE_USER,
      // Even if a caller upstream ever over-fetched, none of this may survive.
      passwordHash: "$2a$10$notasecretatall",
      accessToken: "tok_live_123",
    });

    const context = await getShellContext();
    const serialized = JSON.stringify(context);

    for (const forbidden of [
      "passwordHash",
      "$2a$",
      "accessToken",
      "tok_live_123",
      "refreshToken",
      "AUTH_SECRET",
      "DATABASE_URL",
    ]) {
      expect(serialized, `shell payload leaked ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("exposes exactly the three documented sections and nothing more", async () => {
    const context = await getShellContext();

    expect(Object.keys(context).sort()).toEqual(["tiktokStatus", "user", "workspace"]);
    expect(Object.keys(context.user).sort()).toEqual(["email", "image", "name", "role"]);
  });
});
