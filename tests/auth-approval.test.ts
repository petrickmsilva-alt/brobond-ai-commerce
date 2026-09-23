import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { hashToken, invitationExpiry } from "@/lib/tokens";

/**
 * PR010.3 §2 — approval orchestration: "Ao aprovar: Criar Invitation".
 *
 * These tests exercise the real orchestration against an in-memory fake
 * Prisma (the same pattern as `tests/auth-invitation.test.ts`), with a fake
 * mailer capturing the delivery:
 *
 *   1. approving a PENDING request issues an invitation (role MEMBER,
 *      reviewer's tenant) and delivers the link through the mailer;
 *   2. only PENDING requests can be reviewed — a double click creates
 *      nothing;
 *   3. rejecting records the decision and provisions nothing;
 *   4. an approval still is NOT an account — the invitee must redeem the
 *      single-use link (that part is covered by the invitation tests).
 *
 * `@/lib/prisma` is mocked so importing the module never instantiates a real
 * client, and bcrypt is stubbed to keep the suite fast.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
}));

const { createApprovalService } = await import("@/modules/auth/approval.service");

const ORG_A = "org_tenant_a";
const ORG_B = "org_tenant_b";
const ADMIN_ID = "user_admin";

type Row = Record<string, unknown>;

/** In-memory Prisma double covering every call the orchestrator makes. */
function makeDb() {
  const accessRequests: Row[] = [];
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
    accessRequest: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        return accessRequests.find((row) => matches(row, where)) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        return accessRequests.find((row) => matches(row, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: Row }) => {
        return accessRequests.filter((row) => matches(row, where ?? {}));
      }),
      count: vi.fn(async ({ where }: { where: Row }) => {
        return accessRequests.filter((row) => matches(row, where ?? {})).length;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        sequence += 1;
        const row = { id: `req_${sequence}`, createdAt: new Date(), ...data };
        accessRequests.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = accessRequests.find((item) => matches(item, where));
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
    },
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
        const row = { id: `inv_${sequence}`, acceptedAt: null, createdAt: new Date(), ...data };
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

  return { db, accessRequests, invitations, users, organizations };
}

/** The payload shape the mailer double captures. */
interface MailedPayload {
  to: string;
  invitedName: string | null;
  organizationName: string;
  role: UserRole;
  inviteUrl: string;
  expiresAt: Date;
}

/** Mailer double — captures the payload instead of logging it. */
function makeMailer() {
  return {
    provider: "console" as const,
    sendInvitation: vi.fn(async (_payload: MailedPayload) => undefined),
  };
}

/** The payload of the ( asserted ) first mailer call, undefined-safe. */
function mailedPayload(): MailedPayload {
  const call = mailer.sendInvitation.mock.calls[0];
  if (!call) throw new Error("expected the mailer to have been called");
  return call[0];
}

const BASE_URL = "https://app.brobond.ai";
const NOW = new Date("2026-09-23T10:00:00.000Z");

let fake: ReturnType<typeof makeDb>;
let mailer: ReturnType<typeof makeMailer>;
let service: ReturnType<typeof createApprovalService>;

beforeEach(() => {
  fake = makeDb();
  mailer = makeMailer();
  service = createApprovalService({
    db: fake.db as never,
    mailer,
    getBaseUrl: () => BASE_URL,
    now: () => NOW,
  });
});

async function seedRequest(overrides: Row = {}): Promise<Row> {
  const row = {
    id: "req_1",
    name: "Ana Ribeiro",
    company: "Empresa A",
    email: "ana@empresa.com",
    whatsapp: "+55 11 90000-0000",
    message: "Quero testar a plataforma.",
    status: "PENDING",
    reviewNote: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: new Date("2026-09-22T00:00:00.000Z"),
    updatedAt: new Date("2026-09-22T00:00:00.000Z"),
    ...overrides,
  };
  fake.accessRequests.push(row);
  return row;
}

// ------------------------------------------------------------------
// approve()
// ------------------------------------------------------------------

describe("approve() — the §2 contract", () => {
  it("approves the request", async () => {
    await seedRequest();
    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.status).toBe("APPROVED");
    // The view deliberately omits `reviewedBy` (an internal user id) — the
    // row itself must still carry the audit trail.
    expect((fake.accessRequests[0] as Row).reviewedBy).toBe(ADMIN_ID);
  });

  it("creates an invitation — 'Ao aprovar: Criar Invitation'", async () => {
    await seedRequest();
    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });

    expect(result.ok).toBe(true);
    expect(fake.invitations).toHaveLength(1);
    expect(fake.invitations[0]?.email).toBe("ana@empresa.com");
    expect(fake.invitations[0]?.name).toBe("Ana Ribeiro");
  });

  it("issues the invitation in the REVIEWER's tenant, never from input", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    expect(fake.invitations[0]?.organizationId).toBe(ORG_A);
    expect(fake.invitations[0]?.organizationId).not.toBe(ORG_B);
  });

  it("always invites as MEMBER — an access request can never mint a MANAGER", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    expect(fake.invitations[0]?.role).toBe(UserRole.MEMBER);
  });

  it("records the reviewer on the invitation", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    expect(fake.invitations[0]?.invitedBy).toBe(ADMIN_ID);
  });

  it("stores ONLY the token digest — the raw token lives in the URL alone", async () => {
    await seedRequest();
    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });
    if (!result.ok) throw new Error("expected success");

    const stored = fake.invitations[0] as Row;
    const url = new URL(result.inviteUrl);
    const rawToken = url.pathname.split("/").pop() ?? "";

    expect(stored.tokenHash).toBe(hashToken(rawToken));
    expect(JSON.stringify(stored)).not.toContain(rawToken);
  });

  it("delivers through the mailer exactly once", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    expect(mailer.sendInvitation).toHaveBeenCalledTimes(1);
  });

  it("builds the invite URL from the injected base URL", async () => {
    await seedRequest();
    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });
    if (!result.ok) throw new Error("expected success");

    expect(result.inviteUrl).toMatch(new RegExp(`^${BASE_URL}/invite/[A-Za-z0-9_-]+$`));
  });

  it("returns the invite URL so the ADMIN can copy it", async () => {
    await seedRequest();
    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });
    if (!result.ok) throw new Error("expected success");

    expect(result.inviteUrl).toContain("/invite/");
  });

  it("reports delivered: true on a successful send", async () => {
    await seedRequest();
    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });
    if (!result.ok) throw new Error("expected success");

    expect(result.delivered).toBe(true);
  });

  it("mails the invitee, not the reviewer", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    expect(mailedPayload().to).toBe("ana@empresa.com");
  });

  it("mails the workspace name resolved from the reviewer's tenant", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    expect(mailedPayload().organizationName).toBe("Tenant A");
  });

  it("mails the invited role (MEMBER) and the invitation expiry", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    const payload = mailedPayload();
    expect(payload.role).toBe(UserRole.MEMBER);
    expect(payload.expiresAt).toEqual(invitationExpiry(NOW));
  });

  it("the invitation expires in exactly 7 days", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    const expiresAt = fake.invitations[0]?.expiresAt as Date;
    expect(expiresAt.getTime() - NOW.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("records the review timestamp from the injected clock", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    const request = fake.accessRequests[0] as Row;
    expect(request.reviewedAt).toEqual(NOW);
  });

  it("persists the review note when provided", async () => {
    await seedRequest();
    await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
      note: "Lead qualificado",
    });

    expect((fake.accessRequests[0] as Row).reviewNote).toBe("Lead qualificado");
  });

  it("a mailer failure does not roll anything back — it reports delivered: false", async () => {
    await seedRequest();
    mailer.sendInvitation.mockRejectedValueOnce(new Error("SMTP down"));

    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.delivered).toBe(false);
    expect(result.inviteUrl).toContain("/invite/");
    expect(fake.invitations).toHaveLength(1);
    expect((fake.accessRequests[0] as Row).status).toBe("APPROVED");
  });

  it("never sends password material through the mailer", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    const serialized = JSON.stringify(mailer.sendInvitation.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("AUTH_SECRET");
  });
});

// ------------------------------------------------------------------
// approve() — refusals
// ------------------------------------------------------------------

describe("approve() — refusals", () => {
  it("returns NOT_FOUND for an unknown request", async () => {
    const result = await service.approve({
      requestId: "req_missing",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(fake.invitations).toHaveLength(0);
    expect(mailer.sendInvitation).not.toHaveBeenCalled();
  });

  it("returns ALREADY_REVIEWED for an approved request (double click)", async () => {
    await seedRequest({ status: "APPROVED" });
    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });

    expect(result).toMatchObject({ ok: false, code: "ALREADY_REVIEWED" });
    expect(fake.invitations).toHaveLength(0);
    expect(mailer.sendInvitation).not.toHaveBeenCalled();
  });

  it("returns ALREADY_REVIEWED for a rejected request", async () => {
    await seedRequest({ status: "REJECTED" });
    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });

    expect(result).toMatchObject({ ok: false, code: "ALREADY_REVIEWED" });
  });

  it("a second approve after a successful one creates nothing new", async () => {
    await seedRequest();
    await service.approve({ requestId: "req_1", reviewerId: ADMIN_ID, organizationId: ORG_A });

    const second = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });

    expect(second).toMatchObject({ ok: false, code: "ALREADY_REVIEWED" });
    expect(fake.invitations).toHaveLength(1);
    expect(mailer.sendInvitation).toHaveBeenCalledTimes(1);
  });

  it("returns USER_EXISTS and leaves the request PENDING when the email has an account", async () => {
    await seedRequest();
    fake.users.push({ id: "user_existing", email: "ana@empresa.com" });

    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });

    expect(result).toMatchObject({ ok: false, code: "USER_EXISTS" });
    expect(fake.invitations).toHaveLength(0);
    expect(mailer.sendInvitation).not.toHaveBeenCalled();
    expect((fake.accessRequests[0] as Row).status).toBe("PENDING");
  });

  it("surfaces a human-readable error message on every refusal", async () => {
    await seedRequest({ status: "APPROVED" });
    const result = await service.approve({
      requestId: "req_1",
      reviewerId: ADMIN_ID,
      organizationId: ORG_A,
    });
    if (result.ok) throw new Error("expected failure");

    expect(result.error.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------
// reject()
// ------------------------------------------------------------------

describe("reject()", () => {
  it("rejects a PENDING request and provisions NOTHING", async () => {
    await seedRequest();
    const result = await service.reject({ requestId: "req_1", reviewerId: ADMIN_ID });

    expect(result.ok).toBe(true);
    expect((fake.accessRequests[0] as Row).status).toBe("REJECTED");
    expect(fake.invitations).toHaveLength(0);
    expect(mailer.sendInvitation).not.toHaveBeenCalled();
  });

  it("records the reviewer and the review timestamp", async () => {
    await seedRequest();
    await service.reject({ requestId: "req_1", reviewerId: ADMIN_ID, note: "Fora do perfil" });

    const request = fake.accessRequests[0] as Row;
    expect(request.reviewedBy).toBe(ADMIN_ID);
    expect(request.reviewedAt).toEqual(NOW);
    expect(request.reviewNote).toBe("Fora do perfil");
  });

  it("returns NOT_FOUND for an unknown request", async () => {
    const result = await service.reject({ requestId: "req_missing", reviewerId: ADMIN_ID });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("returns ALREADY_REVIEWED for a non-pending request", async () => {
    await seedRequest({ status: "APPROVED" });
    const result = await service.reject({ requestId: "req_1", reviewerId: ADMIN_ID });
    expect(result).toMatchObject({ ok: false, code: "ALREADY_REVIEWED" });
    expect((fake.accessRequests[0] as Row).status).toBe("APPROVED");
  });
});

// ------------------------------------------------------------------
// deliverInvitation() — the shared delivery step
// ------------------------------------------------------------------

describe("deliverInvitation()", () => {
  it("builds the URL from the base and the raw token", async () => {
    const result = await service.deliverInvitation({
      organizationId: ORG_A,
      email: "ana@empresa.com",
      name: "Ana Ribeiro",
      role: UserRole.MANAGER,
      token: "tok_raw_value",
      expiresAt: NOW,
    });

    expect(result.inviteUrl).toBe(`${BASE_URL}/invite/tok_raw_value`);
  });

  it("passes the role through to the mailer", async () => {
    await service.deliverInvitation({
      organizationId: ORG_A,
      email: "ana@empresa.com",
      name: null,
      role: UserRole.MANAGER,
      token: "tok_raw_value",
      expiresAt: NOW,
    });

    expect(mailer.sendInvitation.mock.calls[0]?.[0].role).toBe(UserRole.MANAGER);
  });

  it("resolves the organization name for the message", async () => {
    await service.deliverInvitation({
      organizationId: ORG_B,
      email: "ana@empresa.com",
      name: null,
      role: UserRole.MEMBER,
      token: "tok",
      expiresAt: NOW,
    });

    expect(mailer.sendInvitation.mock.calls[0]?.[0].organizationName).toBe("Tenant B");
  });

  it("falls back to 'Workspace' when the organization lookup misses", async () => {
    await service.deliverInvitation({
      organizationId: "org_ghost",
      email: "ana@empresa.com",
      name: null,
      role: UserRole.MEMBER,
      token: "tok",
      expiresAt: NOW,
    });

    expect(mailer.sendInvitation.mock.calls[0]?.[0].organizationName).toBe("Workspace");
  });

  it("reports delivered: false when the mailer throws", async () => {
    mailer.sendInvitation.mockRejectedValueOnce(new Error("boom"));
    const result = await service.deliverInvitation({
      organizationId: ORG_A,
      email: "ana@empresa.com",
      name: null,
      role: UserRole.MEMBER,
      token: "tok",
      expiresAt: NOW,
    });

    expect(result.delivered).toBe(false);
  });
});
