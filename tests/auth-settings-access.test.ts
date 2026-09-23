import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthorizationError } from "@/lib/rbac";
import { isProtectedRoute } from "@/lib/auth-routes";

/**
 * PR010.3 §2 — the ADMIN approval surface at /dashboard/settings/access.
 *
 * Three layers, each pinned:
 *
 *   1. ROUTE — protected by the middleware perimeter (`/dashboard` prefix).
 *   2. ACTIONS — `requireAdmin()` first, always; approve delegates to the
 *      approval orchestrator with the SESSION's tenant; both surfaces
 *      (`/settings` and this page) are revalidated on success.
 *   3. PAGE — ADMIN-only by rendering a restricted state for others; the
 *      queue is only READ for an ADMIN (a MANAGER's render never touches it).
 */

const requireAdminMock = vi.hoisted(() => vi.fn());
const approveMock = vi.hoisted(() => vi.fn());
const rejectMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
const countsMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({
  requireAdmin: requireAdminMock,
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("@/modules/auth/approval.service", () => ({
  approvalService: { approve: approveMock, reject: rejectMock },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/auth/access-request.service", () => ({
  accessRequestService: { list: listMock, counts: countsMock },
}));

const { reviewAccessRequestAction } = await import("@/app/dashboard/settings/access/actions");
const AccessSettingsPage = (await import("@/app/dashboard/settings/access/page")).default;

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * Cycle-safe string collector for React element trees. Server Components may
 * reference module namespaces (icon components, motion presets) whose graphs
 * are circular, which JSON.stringify cannot serialize — but every *rendered*
 * string still lives somewhere in the props.
 */
function collectStrings(
  node: unknown,
  seen: Set<unknown> = new Set(),
  out: Set<string> = new Set(),
): Set<string> {
  if (typeof node === "string") {
    out.add(node);
  } else if (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectStrings(value, seen, out);
    }
  }
  return out;
}

const ADMIN = {
  id: "user_admin",
  email: "admin@brobond.ai",
  name: "Admin",
  image: null,
  role: "ADMIN",
  organizationId: "org_a",
};

const MEMBER = { ...ADMIN, id: "user_member", role: "MEMBER", organizationId: "org_a" };
const MANAGER = { ...ADMIN, id: "user_manager", role: "MANAGER", organizationId: "org_a" };

beforeEach(() => {
  requireAdminMock.mockReset();
  approveMock.mockReset();
  rejectMock.mockReset();
  revalidatePathMock.mockClear();
  listMock.mockReset();
  countsMock.mockReset();
  getCurrentUserMock.mockReset();

  listMock.mockResolvedValue([]);
  countsMock.mockResolvedValue({ pending: 0, approved: 0, rejected: 0, total: 0 });
});

// ------------------------------------------------------------------
// Route
// ------------------------------------------------------------------

describe("the route", () => {
  it("lives at /dashboard/settings/access", () => {
    expect(read("app/dashboard/settings/access/page.tsx")).toBeTruthy();
  });

  it("is inside the protected perimeter", () => {
    expect(isProtectedRoute("/dashboard/settings/access")).toBe(true);
  });

  it("is linked from the sidebar navigation", () => {
    const source = read("lib/navigation.ts");
    expect(source).toContain('"/dashboard/settings/access"');
  });
});

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------

describe("reviewAccessRequestAction()", () => {
  it("requires an ADMIN before anything else", async () => {
    requireAdminMock.mockRejectedValue(new AuthorizationError("Forbidden", 403));

    const result = await reviewAccessRequestAction({ id: "req_1", decision: "APPROVED" });

    expect(result.ok).toBe(false);
    expect(approveMock).not.toHaveBeenCalled();
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload with field errors", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);

    const result = await reviewAccessRequestAction({ id: "", decision: "MAYBE" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toBeDefined();
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("APPROVE delegates to the orchestrator with the session's tenant and reviewer", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    approveMock.mockResolvedValue({
      ok: true,
      request: { id: "req_1", status: "APPROVED" },
      invitation: { id: "inv_1", email: "ana@empresa.com", role: "MEMBER", expiresAt: new Date() },
      inviteUrl: "https://app.brobond.ai/invite/tok",
      delivered: true,
    });

    const result = await reviewAccessRequestAction({
      id: "req_1",
      decision: "APPROVED",
      note: "Lead qualificado",
    });

    expect(result.ok).toBe(true);
    expect(approveMock).toHaveBeenCalledWith({
      requestId: "req_1",
      reviewerId: "user_admin",
      organizationId: "org_a",
      note: "Lead qualificado",
    });
  });

  it("APPROVE returns the invite URL so the ADMIN can copy it", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    approveMock.mockResolvedValue({
      ok: true,
      request: {},
      invitation: {},
      inviteUrl: "https://app.brobond.ai/invite/tok",
      delivered: true,
    });

    const result = await reviewAccessRequestAction({ id: "req_1", decision: "APPROVED" });

    expect(result).toEqual({
      ok: true,
      data: { inviteUrl: "https://app.brobond.ai/invite/tok", delivered: true },
    });
  });

  it("APPROVE surfaces the orchestrator's refusal (e.g. already reviewed)", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    approveMock.mockResolvedValue({ ok: false, code: "ALREADY_REVIEWED", error: "Já revisada." });

    const result = await reviewAccessRequestAction({ id: "req_1", decision: "APPROVED" });

    expect(result.ok).toBe(false);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("REJECT delegates to the orchestrator and provisions nothing", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    rejectMock.mockResolvedValue({ ok: true, request: { id: "req_1", status: "REJECTED" } });

    const result = await reviewAccessRequestAction({ id: "req_1", decision: "REJECTED" });

    expect(result.ok).toBe(true);
    // The zod schema normalizes an absent note to null.
    expect(rejectMock).toHaveBeenCalledWith({
      requestId: "req_1",
      reviewerId: "user_admin",
      note: null,
    });
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("revalidates BOTH surfaces on success", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    approveMock.mockResolvedValue({
      ok: true,
      request: {},
      invitation: {},
      inviteUrl: "https://x/invite/t",
      delivered: true,
    });

    await reviewAccessRequestAction({ id: "req_1", decision: "APPROVED" });

    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/settings/access");
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
  });

  it("reports a generic message on an unexpected failure", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    approveMock.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await reviewAccessRequestAction({ id: "req_1", decision: "APPROVED" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain("db down");
    consoleError.mockRestore();
  });

  it("never accepts an organizationId from the client", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    approveMock.mockResolvedValue({
      ok: true,
      request: {},
      invitation: {},
      inviteUrl: "https://x/invite/t",
      delivered: true,
    });

    await reviewAccessRequestAction({
      id: "req_1",
      decision: "APPROVED",
      organizationId: "org_evil",
    });

    expect(approveMock.mock.calls[0]?.[0].organizationId).toBe("org_a");
  });
});

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

describe("the page", () => {
  it("renders the restricted state for a MEMBER", async () => {
    getCurrentUserMock.mockResolvedValue(MEMBER);

    const element = await AccessSettingsPage();

    expect([...collectStrings(element)].join("\n")).toContain("Acesso restrito");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("renders the restricted state for a MANAGER", async () => {
    getCurrentUserMock.mockResolvedValue(MANAGER);

    const element = await AccessSettingsPage();
    expect([...collectStrings(element)].join("\n")).toContain("Acesso restrito");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("reads the queue ONLY for an ADMIN", async () => {
    getCurrentUserMock.mockResolvedValue(ADMIN);
    listMock.mockResolvedValue([
      {
        id: "req_1",
        name: "Ana Ribeiro",
        company: "Empresa A",
        email: "ana@empresa.com",
        whatsapp: "+55 11 90000-0000",
        message: null,
        status: "PENDING",
        reviewNote: null,
        reviewedAt: null,
        createdAt: new Date("2026-09-22T00:00:00.000Z"),
      },
    ]);
    countsMock.mockResolvedValue({ pending: 1, approved: 0, rejected: 0, total: 1 });

    const element = await AccessSettingsPage();

    expect(listMock).toHaveBeenCalledWith({ take: 50 });
    const strings = [...collectStrings(element)].join("\n");
    expect(strings).toContain("Fila de solicitações");
    expect(strings).toContain("Ana Ribeiro");
  });

  it("states the §2 rule in its own description (aprovar cria convite)", async () => {
    getCurrentUserMock.mockResolvedValue(ADMIN);

    const element = await AccessSettingsPage();
    expect([...collectStrings(element)].join("\n")).toContain("Aprovar cria e envia");
  });

  it("uses the shared table component", () => {
    expect(read("app/dashboard/settings/access/page.tsx")).toContain("AccessRequestsTable");
  });
});

// ------------------------------------------------------------------
// Table contract (§2 — Nome · Empresa · Email · Telefone · Status)
// ------------------------------------------------------------------

describe("the table", () => {
  const source = read("components/settings/access-requests-table.tsx");

  it("renders the five §2 columns", () => {
    for (const column of ["Nome", "Empresa", "Email", "Telefone", "Status"]) {
      expect(source, column).toContain(`<TableHead>${column}</TableHead>`);
    }
  });

  it("offers Aprovar and Rejeitar actions", () => {
    expect(source).toContain("Aprovar");
    expect(source).toContain("Rejeitar");
  });

  it("only offers actions for a PENDING request", () => {
    expect(source).toMatch(/request\.status === "PENDING"/);
    expect(source).toContain("Revisada");
  });

  it("hides the action column entirely for non-admins (canManage)", () => {
    expect(source).toContain("canManage");
    expect(source).toMatch(/\{canManage && <TableHead/);
  });

  it("shows the issued invite URL exactly once, with a copy affordance", () => {
    expect(source).toContain("inviteUrl");
    expect(source).toContain("Copiar");
    expect(source).toMatch(/mostrado apenas uma vez|uma única vez/);
  });

  it("surfaces action errors without losing the table", () => {
    expect(source).toContain('role="alert"');
  });

  it("labels the phone column Telefone (spec §2)", () => {
    expect(source).toContain("<TableHead>Telefone</TableHead>");
  });

  it("is a Client Component (per-row busy state)", () => {
    expect(source.startsWith('"use client"')).toBe(true);
  });

  it("never reads a secret", () => {
    expect(source).not.toContain("AUTH_SECRET");
    expect(source).not.toContain("GOOGLE_CLIENT_SECRET");
    expect(source).not.toContain("process.env");
  });
});

// ------------------------------------------------------------------
// The legacy /settings surface delegates (no drift between surfaces)
// ------------------------------------------------------------------

describe("the legacy /settings surface", () => {
  it("delegates review to the canonical action", () => {
    const source = read("app/settings/actions.ts");
    expect(source).toContain('from "@/app/dashboard/settings/access/actions"');
    expect(source).toMatch(/reviewAccessRequestAction as reviewAccessRequest/);
  });

  it("the manual invite action now delivers through the mailer", () => {
    const source = read("app/settings/actions.ts");
    expect(source).toContain("deliverInvitation");
  });

  it("the legacy panel documents the new approve behaviour", () => {
    const source = read("components/settings/access-requests-panel.tsx");
    expect(source).toMatch(/Aprovar emite e envia|Aprovar cria e envia/);
  });
});
