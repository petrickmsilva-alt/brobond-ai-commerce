import "server-only";

import type { UserRole } from "@prisma/client";
import { APP_SHORT_NAME } from "@/lib/constants";

/**
 * Invitation delivery (PR010.3 §9 — Email Service).
 *
 * WHAT THIS IS
 * ------------
 * The seam between "an invitation exists" and "the invitee can click it".
 * Approval and manual invites produce an `Invitation` + a raw token; this
 * module turns that into an outbound message.
 *
 * `InvitationMailer` is the interface. Production delivery uses Resend and
 * refuses to send when the provider is not configured. Invitation URLs embed
 * single-use bearer tokens, so they must never be used as a log transport.
 *
 * SECURITY CONTRACT
 * -----------------
 * - The invite URL contains the RAW token and may only travel to the email
 *   provider. It is never written to logs or persisted (only its SHA-256
 *   digest is stored).
 * - The mailer never receives, and therefore can never leak, a password hash,
 *   a session token or another user's data: the payload is one invitee, one
 *   workspace, one link.
 * - `formatInvitationEmail()` is pure and exported for tests.
 */

/** Everything the mailer needs — and nothing it does not. */
export interface InvitationEmailPayload {
  /** The invitee's email (the address the invitation was issued to). */
  to: string;
  /** The invitee's name, when known from the request/invitation. */
  invitedName: string | null;
  /** Workspace the invitee is joining — shown so a phishing link is tellable. */
  organizationName: string;
  /** Role the invitee will receive on acceptance (from the invitation row). */
  role: UserRole;
  /** Single-use invitation link — carries the raw token. */
  inviteUrl: string;
  /** When the invitation stops working. */
  expiresAt: Date;
}

/** Transport providers. */
export type MailerProvider = "resend" | "unconfigured";

/** The seam every invitation delivery must implement (PR010.3 §9). */
export interface InvitationMailer {
  /** Transport identifier — for logs and dashboards, nothing else. */
  readonly provider: MailerProvider;
  /**
   * Deliver one invitation email.
   *
   * Implementations SHOULD reject malformed payloads (blank `to`, blank
   * `inviteUrl`) rather than silently dropping the message.
   */
  sendInvitation(payload: InvitationEmailPayload): Promise<void>;
}

/** Rendered message delivered by the configured provider. */
export interface RenderedInvitationEmail {
  subject: string;
  text: string;
}

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Manager",
  MEMBER: "Membro",
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Render the invitation message (pure — no I/O, no locale drift).
 *
 * Exported so the wording is unit-tested exactly as delivered.
 */
export function formatInvitationEmail(payload: InvitationEmailPayload): RenderedInvitationEmail {
  const greeting = payload.invitedName ? `Olá, ${payload.invitedName}!` : "Olá!";

  const subject = `Convite para acessar ${payload.organizationName} no ${APP_SHORT_NAME}`;
  const text = [
    `${greeting}`,
    ``,
    `Você foi convidado para o workspace "${payload.organizationName}" no ${APP_SHORT_NAME}, com o papel de ${ROLE_LABEL[payload.role] ?? payload.role}.`,
    ``,
    `Para ativar seu acesso, defina sua senha através do link abaixo:`,
    `${payload.inviteUrl}`,
    ``,
    `O link é de uso único e expira em ${formatDate(payload.expiresAt)}.`,
    ``,
    `Se você não esperava este convite, ignore esta mensagem.`,
    ``,
    `— Equipe ${APP_SHORT_NAME}`,
  ].join("\n");

  return { subject, text };
}

export class ResendMailer implements InvitationMailer {
  readonly provider = "resend" as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly send: typeof fetch = fetch,
  ) {}

  async sendInvitation(payload: InvitationEmailPayload): Promise<void> {
    if (!payload.to?.trim()) throw new Error("Invitation mailer: missing recipient.");
    if (!payload.inviteUrl?.trim()) throw new Error("Invitation mailer: missing invite URL.");

    const email = formatInvitationEmail(payload);
    const response = await this.send("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: this.from, to: [payload.to], subject: email.subject, text: email.text }),
    });

    if (!response.ok) {
      throw new Error(`Invitation mailer: Resend delivery failed (${response.status}).`);
    }
  }
}

class UnconfiguredInvitationMailer implements InvitationMailer {
  readonly provider = "unconfigured" as const;

  async sendInvitation(_payload: InvitationEmailPayload): Promise<void> {
    throw new Error("Invitation mailer is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  }
}

/** Minimal environment shape — injectable so tests never mutate globals. */
export type MailerEnv = Record<string, string | undefined>;

/**
 * Compose the deployment's mailer (PR010.3 §9).
 *
 * A configured Resend transport delivers every invitation.
 * The `RESEND_API_KEY` branch is reserved: when the Resend integration ships,
 * this factory (and only this factory) changes, returning a `ResendMailer`
 * that implements the same `InvitationMailer` interface. Until then the
 * variable is deliberately ignored so an early value cannot half-activate an
 * unimplemented transport.
 */
export function createInvitationMailer(env: MailerEnv = process.env): InvitationMailer {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  if (apiKey && from) return new ResendMailer(apiKey, from);
  return new UnconfiguredInvitationMailer();
}
