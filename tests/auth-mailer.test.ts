import { describe, expect, it, vi } from "vitest";
import { UserRole } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { ResendMailer, createInvitationMailer, formatInvitationEmail } =
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
  it("renders the invitation link for the transactional provider", () => {
    const email = formatInvitationEmail(PAYLOAD);
    expect(email.subject).toBe("Convite para acessar Brobond Comércio no Brobond");
    expect(email.text).toContain(PAYLOAD.inviteUrl);
    expect(email.text).toContain("Olá, Ana Ribeiro!");
    expect(email.text).toContain("Membro");
    expect(email.text).toContain("uso único");
  });

  it("does not add material that was not provided", () => {
    const serialized = JSON.stringify(formatInvitationEmail(PAYLOAD));
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("AUTH_SECRET");
  });
});

describe("ResendMailer", () => {
  it("sends the invitation only to Resend", async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const mailer = new ResendMailer("re_test", "Brobond <convites@brobond.ai>", send);

    await expect(mailer.sendInvitation(PAYLOAD)).resolves.toBeUndefined();
    expect(mailer.provider).toBe("resend");
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );

    const [, request] = send.mock.calls[0]!;
    expect(JSON.stringify(request)).toContain(PAYLOAD.inviteUrl);
  });

  it("rejects malformed input without sending", async () => {
    const send = vi.fn();
    const mailer = new ResendMailer("re_test", "Brobond <convites@brobond.ai>", send);

    await expect(mailer.sendInvitation({ ...PAYLOAD, to: "" })).rejects.toThrow(/recipient/i);
    await expect(mailer.sendInvitation({ ...PAYLOAD, inviteUrl: "" })).rejects.toThrow(
      /invite URL/i,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("fails explicitly when the provider rejects delivery", async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const mailer = new ResendMailer("re_test", "Brobond <convites@brobond.ai>", send);

    await expect(mailer.sendInvitation(PAYLOAD)).rejects.toThrow(/failed \(401\)/i);
  });
});

describe("createInvitationMailer()", () => {
  it("requires complete provider configuration rather than logging a bearer URL", async () => {
    const mailer = createInvitationMailer({});

    expect(mailer.provider).toBe("unconfigured");
    await expect(mailer.sendInvitation(PAYLOAD)).rejects.toThrow(/not configured/i);
  });

  it("creates the Resend transport only with an API key and sender", () => {
    expect(
      createInvitationMailer({
        RESEND_API_KEY: "re_test",
        RESEND_FROM_EMAIL: "Brobond <convites@brobond.ai>",
      }).provider,
    ).toBe("resend");
  });
});
