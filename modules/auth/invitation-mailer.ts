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
 * `InvitationMailer` is the interface. `ConsoleMailer` is the only
 * implementation today — it prints the invitation link to the server log,
 * which is the PR010.3 delivery channel ("Enviar link no log"). A future
 * `ResendMailer` implements the same interface with zero caller changes:
 *
 *   export class ResendMailer implements InvitationMailer {
 *     readonly provider = "resend" as const;
 *     constructor(private readonly apiKey: string) {}
 *     async sendInvitation(payload: InvitationEmailPayload) {
 *       await fetch("https://api.resend.com/emails", { … });
 *     }
 *   }
 *
 * …and `createInvitationMailer()` grows one branch:
 *
 *   if (present(env, "RESEND_API_KEY")) return new ResendMailer(env.RESEND_API_KEY);
 *
 * Nothing else in the codebase knows which mailer is wired, which is exactly
 * what makes the swap safe.
 *
 * SECURITY CONTRACT
 * -----------------
 * - The invite URL contains the RAW token — that is the delivery channel, the
 *   same way an email would carry it. It must only travel through this
 *   interface (log line today, email tomorrow), never into a persisted column
 *   (only the SHA-256 digest is stored).
 * - The mailer never receives, and therefore can never leak, a password hash,
 *   a session token or another user's data: the payload is one invitee, one
 *   workspace, one link.
 * - `formatInvitationEmail()` is pure and exported for tests; `ConsoleMailer`
 *   accepts an injectable logger for the same reason.
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

/** Transport providers. `resend` is reserved for the future implementation. */
export type MailerProvider = "console" | "resend";

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

/** Rendered message — the shape `ConsoleMailer` logs and Resend will send. */
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

/**
 * The PR010.3 delivery channel: the invitation link in the server log.
 *
 * In development (and until Resend ships) the operator reads the log to copy
 * the link. The message is prefixed so it is greppable
 * (`grep "invitation-mailer"`), and the full rendered email is logged — the
 * same bytes a real transport would send.
 */
export class ConsoleMailer implements InvitationMailer {
  readonly provider = "console" as const;

  constructor(private readonly log: (...args: unknown[]) => void = console.info) {}

  async sendInvitation(payload: InvitationEmailPayload): Promise<void> {
    if (!payload.to?.trim()) throw new Error("Invitation mailer: missing recipient.");
    if (!payload.inviteUrl?.trim()) throw new Error("Invitation mailer: missing invite URL.");

    const email = formatInvitationEmail(payload);
    this.log(
      `[invitation-mailer:console] → ${payload.to}`,
      `\nsubject: ${email.subject}\n${email.text}`,
    );
  }
}

/** Minimal environment shape — injectable so tests never mutate globals. */
export type MailerEnv = Record<string, string | undefined>;

/**
 * Compose the deployment's mailer (PR010.3 §9).
 *
 * Today every deployment — production included — gets the `ConsoleMailer`.
 * The `RESEND_API_KEY` branch is reserved: when the Resend integration ships,
 * this factory (and only this factory) changes, returning a `ResendMailer`
 * that implements the same `InvitationMailer` interface. Until then the
 * variable is deliberately ignored so an early value cannot half-activate an
 * unimplemented transport.
 */
export function createInvitationMailer(_env: MailerEnv = process.env): InvitationMailer {
  return new ConsoleMailer();
}
