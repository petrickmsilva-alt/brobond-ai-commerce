import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INVITE_EXPIRED_ROUTE, INVITE_INVALID_ROUTE, SIGNUP_ROUTE } from "@/lib/auth-routes";

/**
 * PR010.3 §10 — invite error pages and the redirect contract.
 *
 * `/invite/[token]` no longer renders an inline rejection: it redirects to
 * `/invite/expired` (link ran out of time) or `/invite/invalid` (link cannot
 * be trusted), each a stable page with its own wording and next steps.
 *
 * The page component is exercised directly: `invitationService.preview` is
 * faked per case and `next/navigation.redirect` is mocked to throw the same
 * NEXT_REDIRECT error the real one throws, so the tests assert exactly where
 * each failure lands.
 */

const previewMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT");
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
);

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/modules/auth/invitation.service", () => ({
  invitationService: { preview: previewMock },
  InvitationError: class InvitationError extends Error {
    constructor(
      public reason: "not_found" | "expired" | "revoked" | "accepted",
      message: string,
    ) {
      super(message);
      this.name = "InvitationError";
    }
  },
}));
// The accept form imports the invite action, which pulls in NextAuth (and
// through it `next/server`, which does not resolve in the node test
// environment). The action itself is covered by its own tests; here only the
// page's routing behaviour matters, so the module is cut at the seam.
vi.mock("@/app/invite/actions", () => ({ acceptInvitationAction: vi.fn() }));

const InvitePage = (await import("@/app/invite/[token]/page")).default;
const InviteInvalidPage = (await import("@/app/invite/invalid/page")).default;
const InviteExpiredPage = (await import("@/app/invite/expired/page")).default;

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const exists = (relative: string) => existsSync(join(ROOT, relative));

function pageProps(token: string) {
  return { params: Promise.resolve({ token }) };
}

// The mocked InvitationError class, constructed exactly as the service does.
const { InvitationError } = await import("@/modules/auth/invitation.service");

beforeEach(() => {
  previewMock.mockReset();
  redirectMock.mockClear();
});

describe("the reserved routes exist as pages (§10)", () => {
  it("/invite/invalid has a page", () => {
    expect(exists("app/invite/invalid/page.tsx")).toBe(true);
  });

  it("/invite/expired has a page", () => {
    expect(exists("app/invite/expired/page.tsx")).toBe(true);
  });

  it("/request-access/success is GONE (PR010.4 §1)", () => {
    expect(exists("app/request-access/success/page.tsx")).toBe(false);
    expect(exists("app/request-access/page.tsx")).toBe(false);
  });

  it("/signup replaced it", () => {
    expect(exists("app/signup/page.tsx")).toBe(true);
  });

  it("the route constants point at those pages", () => {
    expect(INVITE_INVALID_ROUTE).toBe("/invite/invalid");
    expect(INVITE_EXPIRED_ROUTE).toBe("/invite/expired");
    expect(SIGNUP_ROUTE).toBe("/signup");
  });
});

describe("/invite/[token] — rejection routing", () => {
  it("redirects an EXPIRED token to /invite/expired", async () => {
    previewMock.mockRejectedValue(new InvitationError("expired", "Este convite expirou."));

    await expect(InvitePage(pageProps("tok_expired"))).rejects.toMatchObject({
      digest: expect.stringContaining(INVITE_EXPIRED_ROUTE),
    });
    expect(redirectMock).toHaveBeenCalledWith(INVITE_EXPIRED_ROUTE);
  });

  it.each(["not_found", "revoked", "accepted"] as const)(
    "redirects a %s token to /invite/invalid",
    async (reason) => {
      previewMock.mockRejectedValue(
        new InvitationError(reason, `Este convite ${reason}.`) as never,
      );

      await expect(InvitePage(pageProps("tok_dead"))).rejects.toMatchObject({
        digest: expect.stringContaining(INVITE_INVALID_ROUTE),
      });
      expect(redirectMock).toHaveBeenCalledWith(INVITE_INVALID_ROUTE);
    },
  );

  it("redirects to /invite/invalid when the preview fails unexpectedly", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    previewMock.mockRejectedValue(new Error("db down"));

    await expect(InvitePage(pageProps("tok_any"))).rejects.toMatchObject({
      digest: expect.stringContaining(INVITE_INVALID_ROUTE),
    });
    // The unexpected failure is logged server-side, never shown raw.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("never redirects a VALID token — the accept form renders", async () => {
    previewMock.mockResolvedValue({
      email: "ana@empresa.com",
      name: "Ana Ribeiro",
      role: "MEMBER",
      organizationName: "Tenant A",
      expiresAt: new Date("2026-09-30T00:00:00.000Z"),
    });

    const element = await InvitePage(pageProps("tok_valid"));
    expect(redirectMock).not.toHaveBeenCalled();
    expect(element).toBeTruthy();
  });

  it("decodes the token from the URL before validating", async () => {
    previewMock
      .mockResolvedValue(null)
      .mockRejectedValueOnce(new InvitationError("not_found", "x") as never);

    await expect(
      InvitePage(pageProps(encodeURIComponent("tok with specials"))),
    ).rejects.toMatchObject({ digest: expect.stringContaining(INVITE_INVALID_ROUTE) });
  });

  it("the redirect happens server-side — the page source never renders an inline rejection card", () => {
    const source = read("app/invite/[token]/page.tsx");
    expect(source).toContain("INVITE_EXPIRED_ROUTE");
    expect(source).toContain("INVITE_INVALID_ROUTE");
    expect(source).not.toContain("Convite indisponível");
  });
});

describe("/invite/invalid", () => {
  it("renders without redirecting", () => {
    expect(() => InviteInvalidPage()).not.toThrow();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("explains that the link does not exist, was used, or was revoked", () => {
    const source = read("app/invite/invalid/page.tsx");
    expect(source).toContain("não existe, já foi utilizado ou foi revogado");
  });

  it("offers the login and signup next steps (PR010.4 §1)", () => {
    const source = read("app/invite/invalid/page.tsx");
    expect(source).toContain('href="/login"');
    expect(source).toContain('href="/signup"');
    expect(source).not.toContain("/request-access");
  });

  it("is a Server Component (no client state on a dead end)", () => {
    expect(read("app/invite/invalid/page.tsx").startsWith('"use client"')).toBe(false);
  });
});

describe("/invite/expired", () => {
  it("renders without redirecting", () => {
    expect(() => InviteExpiredPage()).not.toThrow();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("explains that the link ran out of time (not that it is untrustworthy)", () => {
    const source = read("app/invite/expired/page.tsx");
    expect(source).toContain("expirou");
    expect(source).not.toContain("revogado");
  });

  it("states the 7-day invitation TTL", () => {
    const source = read("app/invite/expired/page.tsx");
    expect(source).toContain("INVITATION_TTL_DAYS");
  });

  it("offers the login and signup next steps (PR010.4 §1)", () => {
    const source = read("app/invite/expired/page.tsx");
    expect(source).toContain('href="/login"');
    expect(source).toContain('href="/signup"');
    expect(source).not.toContain("/request-access");
  });
});

describe("PR010.4 §1 — the request-access flow left no residue", () => {
  it("neither invite error page still points at /request-access", () => {
    expect(read("app/invite/invalid/page.tsx")).not.toContain("/request-access");
    expect(read("app/invite/expired/page.tsx")).not.toContain("/request-access");
  });

  it("both invite error pages point at /signup instead", () => {
    expect(read("app/invite/invalid/page.tsx")).toContain('href="/signup"');
    expect(read("app/invite/expired/page.tsx")).toContain('href="/signup"');
  });

  it("the access-request service and its approval orchestrator are deleted", () => {
    expect(exists("modules/auth/access-request.service.ts")).toBe(false);
    expect(exists("modules/auth/approval.service.ts")).toBe(false);
  });

  it("the access-request UI is deleted", () => {
    expect(exists("components/auth/request-access-form.tsx")).toBe(false);
    expect(exists("components/settings/access-requests-panel.tsx")).toBe(false);
    expect(exists("components/settings/access-requests-table.tsx")).toBe(false);
    expect(exists("app/dashboard/settings/access/page.tsx")).toBe(false);
  });
});
