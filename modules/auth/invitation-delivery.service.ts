import "server-only";

import type { PrismaClient, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildInviteUrl, resolveAppBaseUrl } from "@/lib/app-url";
import { ConsoleMailer, createInvitationMailer, type InvitationMailer } from "./invitation-mailer";

/**
 * Invitation delivery (PR010.4 — extracted from the deleted
 * `approval.service.ts`).
 *
 * WHAT CHANGED IN PR010.4
 * -----------------------
 * PR010.3's approval service existed to turn an approved `AccessRequest` into
 * an invitation. §1 of PR010.4 deletes the access-request flow entirely — a
 * visitor now creates their own tenant at `/signup`, so there is no queue to
 * approve. The one piece of that service that still had a job is this: taking
 * an invitation that an ADMIN issued for a TEAMMATE and mailing the link.
 *
 * INVITATIONS ARE NO LONGER MANDATORY (§1) — they are no longer the only way
 * to get an account, only the way to add someone to an EXISTING workspace.
 * The first user of a tenant never sees one.
 *
 * SECURITY CONTRACT (unchanged from PR010.3)
 * ------------------------------------------
 * - The raw token passes through this function exactly once, into the invite
 *   URL. It is never persisted and never logged by this module.
 * - A mailer failure is reported (`delivered: false`) and never throws: the
 *   invitation already exists and the ADMIN can copy the returned URL or
 *   re-send (which rotates the token).
 * - The organization name is read by id from the caller's session-derived
 *   tenant — never from client input.
 */

export type InvitationDeliveryDatabase = Pick<PrismaClient, "organization">;

export interface DeliverInvitationInput {
  organizationId: string;
  email: string;
  name: string | null;
  role: UserRole;
  /** Raw single-use token. Lives in the URL; never persisted. */
  token: string;
  expiresAt: Date;
}

export interface DeliveryResult {
  /** Single-use invite URL — returned once so the ADMIN can copy it. */
  inviteUrl: string;
  /** Whether the mailer accepted the message (false = logged failure). */
  delivered: boolean;
}

export function createInvitationDeliveryService(deps: {
  db: InvitationDeliveryDatabase;
  mailer?: InvitationMailer;
  /** Base URL for invite links — injectable so tests never touch process.env. */
  getBaseUrl?: () => string;
}) {
  const mailer = deps.mailer ?? new ConsoleMailer();
  const getBaseUrl = deps.getBaseUrl ?? (() => resolveAppBaseUrl());

  return {
    async deliverInvitation(input: DeliverInvitationInput): Promise<DeliveryResult> {
      const organization = await deps.db.organization.findUnique({
        where: { id: input.organizationId },
        select: { name: true },
      });

      const inviteUrl = buildInviteUrl(getBaseUrl(), input.token);

      try {
        await mailer.sendInvitation({
          to: input.email,
          invitedName: input.name,
          organizationName: organization?.name ?? "Workspace",
          role: input.role,
          inviteUrl,
          expiresAt: input.expiresAt,
        });
        return { inviteUrl, delivered: true };
      } catch (error) {
        console.error("[invitation-delivery.deliverInvitation]", error);
        return { inviteUrl, delivered: false };
      }
    },
  };
}

export type InvitationDeliveryService = ReturnType<typeof createInvitationDeliveryService>;

/** Production instance: real Prisma + the deployment's mailer. */
export const invitationDeliveryService = createInvitationDeliveryService({
  db: prisma,
  mailer: createInvitationMailer(),
});
