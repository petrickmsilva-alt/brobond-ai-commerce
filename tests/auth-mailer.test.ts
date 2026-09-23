import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";

/**
 * PR010.3 §9 — Email Service: the InvitationMailer seam.
 *
 * `ConsoleMailer` is the only transport today ("Enviar link no log"); the
 * `InvitationMailer` interface is the preparation for Resend. These tests pin
 * the interface contract, the rendered message (wording is product surface),
 * and the log behaviour — with an injectable logger so nothing actually
 * reaches stdout.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { ConsoleMailer, createInvitationMailer, formatInvitationEmail } =
  await import("@/modules/auth/invitation-mailer");

const PAYLOAD = {
  to: "ana@empresa.com",
  invitedName: "Ana Ribeiro",
  organizationName: "Brobond Comércio",
  role: UserRole.MEMBER,
  inviteUrl: "https://app.brobond.ai/invite/tok_abc123",
  expiresAt: new Date("2026-09-30T12:00:00.000Z"),
};

describe("formatInvitationEmail()", () => {
  it("the subject names the workspace and the product", () => {
    expect(formatInvitationEmail(PAYLOAD).subject).toBe(
      "Convite para acessar Brobond Comércio no Brobond",
    );
  });

  it("the text contains the invite link", () => {
    expect(formatInvitationEmail(PAYLOAD).text).toContain(PAYLOAD.inviteUrl);
  });

  it("the text greets the invitee by name when known", () => {
    expect(formatInvitationEmail(PAYLOAD).text).toContain("Olá, Ana Ribeiro!");
  });

  it("the text greets generically when the name is unknown", () => {
    const email = formatInvitationEmail({ ...PAYLOAD, invitedName: null });
    expect(email.text).toContain("Olá!");
    expect(email.text).not.toContain("Olá, ");
  });

  it("the text names the workspace (anti-phishing affordance)", () => {
    expect(formatInvitationEmail(PAYLOAD).text).toContain("Brobond Comércio");
  });

  it("the text states the invited role in Portuguese", () => {
    expect(formatInvitationEmail(PAYLOAD).text).toContain("Membro");
    expect(formatInvitationEmail({ ...PAYLOAD, role: UserRole.MANAGER }).text).toContain("Manager");
    expect(formatInvitationEmail({ ...PAYLOAD, role: UserRole.ADMIN }).text).toContain(
      "Administrador",
    );
  });

  it("the text mentions the single-use nature and the expiry", () => {
    const text = formatInvitationEmail(PAYLOAD).text;
    expect(text).toContain("uso único");
    expect(text).toContain("expira");
  });

  it("the text tells an unexpected recipient to ignore it", () => {
    expect(formatInvitationEmail(PAYLOAD).text).toContain("ignore esta mensagem");
  });

  it("the expiry date is rendered as a long pt-BR date", () => {
    // 2026-09-30 UTC → "30 de setembro de 2026".
    expect(formatInvitationEmail(PAYLOAD).text).toContain("30 de setembro de 2026");
  });

  it("renders deterministically for the same payload", () => {
    expect(formatInvitationEmail(PAYLOAD)).toEqual(formatInvitationEmail(PAYLOAD));
  });

  it("renders differently for different links", () => {
    const a = formatInvitationEmail(PAYLOAD);
    const b = formatInvitationEmail({ ...PAYLOAD, inviteUrl: "https://other/invite/x" });
    expect(a.text).not.toBe(b.text);
  });

  it("never carries secret material it was not given", () => {
    const serialized = JSON.stringify(formatInvitationEmail(PAYLOAD));
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("AUTH_SECRET");
  });
});

describe("ConsoleMailer", () => {
  it("implements the InvitationMailer interface", () => {
    const mailer = new ConsoleMailer();
    expect(mailer.provider).toBe("console");
    expect(typeof mailer.sendInvitation).toBe("function");
  });

  it("logs the invite link — that IS the PR010.3 delivery channel", async () => {
    const log = vi.fn();
    await new ConsoleMailer(log).sendInvitation(PAYLOAD);
    expect(log).toHaveBeenCalledTimes(1);

    const rendered = JSON.stringify(log.mock.calls[0]);
    expect(rendered).toContain(PAYLOAD.inviteUrl);
  });

  it("logs the recipient address", async () => {
    const log = vi.fn();
    await new ConsoleMailer(log).sendInvitation(PAYLOAD);
    expect(log.mock.calls[0]?.[0]).toContain("ana@empresa.com");
  });

  it("prefixes the log line so the link is greppable", async () => {
    const log = vi.fn();
    await new ConsoleMailer(log).sendInvitation(PAYLOAD);
    expect(String(log.mock.calls[0]?.[0])).toContain("[invitation-mailer:console]");
  });

  it("logs the full rendered email (same bytes a transport would send)", async () => {
    const log = vi.fn();
    await new ConsoleMailer(log).sendInvitation(PAYLOAD);
    const rendered = formatInvitationEmail(PAYLOAD);
    // The second log argument carries the message with real newlines (a
    // JSON.stringify view would escape them).
    const message = String(log.mock.calls[0]?.[1]);

    expect(message).toContain(rendered.subject);
    expect(message).toContain(rendered.text);
  });

  it("logs the subject line as part of the message", async () => {
    const log = vi.fn();
    await new ConsoleMailer(log).sendInvitation(PAYLOAD);
    expect(String(log.mock.calls[0]?.[1])).toContain("subject: Convite para acessar");
  });

  it("resolves — sendInvitation is awaitable", async () => {
    const log = vi.fn();
    await expect(new ConsoleMailer(log).sendInvitation(PAYLOAD)).resolves.toBeUndefined();
  });

  it("rejects a payload without a recipient instead of silently dropping it", async () => {
    const log = vi.fn();
    await expect(new ConsoleMailer(log).sendInvitation({ ...PAYLOAD, to: "" })).rejects.toThrow(
      /recipient/i,
    );
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects a payload without an invite URL", async () => {
    const log = vi.fn();
    await expect(
      new ConsoleMailer(log).sendInvitation({ ...PAYLOAD, inviteUrl: "" }),
    ).rejects.toThrow(/invite URL/i);
    expect(log).not.toHaveBeenCalled();
  });

  it("treats whitespace-only recipient/URL as missing", async () => {
    const log = vi.fn();
    await expect(
      new ConsoleMailer(log).sendInvitation({ ...PAYLOAD, to: "   " }),
    ).rejects.toThrow();
    await expect(
      new ConsoleMailer(log).sendInvitation({ ...PAYLOAD, inviteUrl: "  " }),
    ).rejects.toThrow();
  });
});

describe("createInvitationMailer()", () => {
  it("returns the ConsoleMailer for an empty environment", () => {
    expect(createInvitationMailer({}).provider).toBe("console");
  });

  it("returns the ConsoleMailer even when RESEND_API_KEY is set", () => {
    // The Resend branch is reserved: an early key must not half-activate an
    // unimplemented transport. When Resend ships, this test flips with it.
    expect(createInvitationMailer({ RESEND_API_KEY: "re_early_value" }).provider).toBe("console");
  });

  it("returns a fresh working mailer (usable immediately)", async () => {
    const mailer = createInvitationMailer({});
    await expect(mailer.sendInvitation(PAYLOAD)).resolves.toBeUndefined();
  });
});

describe("the InvitationMailer contract (Resend preparation)", () => {
  const fakeMailer = {
    provider: "console" as const,
    sendInvitation: vi.fn(
      async (_payload: {
        to: string;
        inviteUrl: string;
        organizationName: string;
        role: UserRole;
      }) => undefined,
    ),
  };

  beforeEach(() => {
    fakeMailer.sendInvitation.mockClear();
  });

  it("a mailer double satisfies the interface shape", async () => {
    expect(fakeMailer.provider).toBe("console");
    await fakeMailer.sendInvitation(PAYLOAD);
    expect(fakeMailer.sendInvitation).toHaveBeenCalledWith(PAYLOAD);
  });

  it("the payload carries exactly the fields a transport needs", () => {
    const keys = Object.keys(PAYLOAD).sort();
    expect(keys).toEqual([
      "expiresAt",
      "inviteUrl",
      "invitedName",
      "organizationName",
      "role",
      "to",
    ]);
  });
});
