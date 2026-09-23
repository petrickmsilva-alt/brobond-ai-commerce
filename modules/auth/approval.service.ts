import "server-only";

import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildInviteUrl, resolveAppBaseUrl } from "@/lib/app-url";
import {
  createAccessRequestService,
  type AccessRequestDatabase,
  type AccessRequestView,
} from "./access-request.service";
import {
  InvitationError,
  createInvitationService,
  type InvitationDatabase,
  type InvitationView,
} from "./invitation.service";
import { ConsoleMailer, createInvitationMailer, type InvitationMailer } from "./invitation-mailer";

/**
 * Access-request approval orchestration (PR010.3 §2).
 *
 * WHAT CHANGED VS PR010.2
 * -----------------------
 * PR010.2 kept "approve" and "invite" as two deliberate clicks: approving only
 * recorded the decision. PR010.3 §2 collapses them — "Ao aprovar: Criar
 * Invitation" — because in practice the second click was the one operators
 * forgot, leaving approved leads waiting forever.
 *
 * WHAT DID *NOT* CHANGE
 * ---------------------
 * Approving still provisions nothing on its own: an `Invitation` is not an
 * account. The invitee still has to redeem the single-use link and set a
 * password before a `User` exists (see `invitation.service.ts`). The PR000.2
 * "no public sign-up" contract therefore holds exactly as before.
 *
 * SECURITY CONTRACT
 * -----------------
 * - Only a PENDING request can be reviewed. A second click (double-submit,
 *   stale tab) gets `ALREADY_REVIEWED` and creates nothing.
 * - The invitation is created in the REVIEWER's tenant, from the reviewer's
 *   session — never from client input.
 * - The invited role is fixed at MEMBER (§4): an access request can never
 *   mint a MANAGER, let alone an ADMIN.
 * - The raw token leaves this service exactly twice: once into the invite URL
 *   handed to the mailer, and never anywhere else.
 */

/** Database surface the orchestrator needs (both underlying services). */
export type ApprovalDatabase = AccessRequestDatabase & InvitationDatabase;

/** Why an approval/rejection was refused. */
export type ApprovalErrorCode = "NOT_FOUND" | "ALREADY_REVIEWED" | "USER_EXISTS";

export type ApprovalResult =
  | {
      ok: true;
      request: AccessRequestView;
      invitation: Pick<InvitationView, "id" | "email" | "role" | "expiresAt">;
      /** Single-use invite URL — returned once so the ADMIN can copy it. */
      inviteUrl: string;
      /** Whether the mailer accepted the message (false = logged failure). */
      delivered: boolean;
    }
  | { ok: false; code: ApprovalErrorCode; error: string };

export type RejectionResult =
  | { ok: true; request: AccessRequestView }
  | { ok: false; code: Exclude<ApprovalErrorCode, "USER_EXISTS">; error: string };

/** Shared delivery step: turn a token into a mailed invite URL. */
export interface DeliverInvitationInput {
  organizationId: string;
  email: string;
  name: string | null;
  role: UserRole;
  token: string;
  expiresAt: Date;
}

export interface DeliveryResult {
  inviteUrl: string;
  delivered: boolean;
}

export function createApprovalService(deps: {
  db: ApprovalDatabase;
  mailer?: InvitationMailer;
  /** Base URL for invite links — injectable so tests never touch process.env. */
  getBaseUrl?: () => string;
  /** Clock — injectable for deterministic expiry assertions. */
  now?: () => Date;
}) {
  const accessRequests = createAccessRequestService(deps.db);
  const invitations = createInvitationService(deps.db);
  const mailer = deps.mailer ?? new ConsoleMailer();
  const getBaseUrl = deps.getBaseUrl ?? (() => resolveAppBaseUrl());
  const now = deps.now ?? (() => new Date());

  /**
   * Deliver one invitation through the mailer.
   *
   * Shared by `approve()` (this PR) and the manual invite action, so both
   * paths build the URL and the message identically. A mailer failure is
   * logged and reported (`delivered: false`) but never rolls anything back:
   * the invitation exists, and the ADMIN can re-send it (which rotates the
   * token) from the invitations panel.
   */
  async function deliverInvitation(input: DeliverInvitationInput): Promise<DeliveryResult> {
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
      console.error("[approval.deliverInvitation]", error);
      return { inviteUrl, delivered: false };
    }
  }

  return {
    deliverInvitation,

    /**
     * Approve a PENDING access request: review it AND issue the invitation
     * (role MEMBER, reviewer's tenant), then deliver the link.
     *
     * Ordering: the invitation is created BEFORE the request is marked
     * APPROVED, so a failure mid-way leaves the request PENDING (retryable —
     * `create()` rotates the token of any pending invitation) instead of an
     * approved lead with no invitation.
     */
    async approve(input: {
      requestId: string;
      reviewerId: string;
      organizationId: string;
      note?: string | null;
    }): Promise<ApprovalResult> {
      const request = await deps.db.accessRequest.findUnique({ where: { id: input.requestId } });
      if (!request) {
        return { ok: false, code: "NOT_FOUND", error: "Solicitação não encontrada." };
      }
      if (request.status !== "PENDING") {
        return {
          ok: false,
          code: "ALREADY_REVIEWED",
          error: "Esta solicitação já foi revisada.",
        };
      }

      let created: { invitation: InvitationView; token: string };
      try {
        created = await invitations.create(
          input.organizationId,
          {
            email: request.email,
            name: request.name,
            // §4 — an access request can only ever provision a MEMBER.
            role: "MEMBER" as UserRole,
            invitedBy: input.reviewerId,
          },
          now(),
        );
      } catch (error) {
        if (error instanceof InvitationError) {
          // The only typed failure is "an account already exists for this
          // email" — surface it without touching the request.
          return { ok: false, code: "USER_EXISTS", error: error.message };
        }
        throw error;
      }

      const reviewed = await accessRequests.review(
        request.id,
        "APPROVED",
        input.reviewerId,
        input.note ?? null,
        now(),
      );
      if (!reviewed) {
        return { ok: false, code: "NOT_FOUND", error: "Solicitação não encontrada." };
      }

      const delivery = await deliverInvitation({
        organizationId: input.organizationId,
        email: created.invitation.email,
        name: created.invitation.name,
        role: created.invitation.role,
        token: created.token,
        expiresAt: created.invitation.expiresAt,
      });

      return {
        ok: true,
        request: reviewed,
        invitation: {
          id: created.invitation.id,
          email: created.invitation.email,
          role: created.invitation.role,
          expiresAt: created.invitation.expiresAt,
        },
        inviteUrl: delivery.inviteUrl,
        delivered: delivery.delivered,
      };
    },

    /**
     * Reject a PENDING access request. Creates nothing, sends nothing —
     * the PR010.2 behaviour, unchanged.
     */
    async reject(input: {
      requestId: string;
      reviewerId: string;
      note?: string | null;
    }): Promise<RejectionResult> {
      const request = await deps.db.accessRequest.findUnique({ where: { id: input.requestId } });
      if (!request) {
        return { ok: false, code: "NOT_FOUND", error: "Solicitação não encontrada." };
      }
      if (request.status !== "PENDING") {
        return {
          ok: false,
          code: "ALREADY_REVIEWED",
          error: "Esta solicitação já foi revisada.",
        };
      }

      const reviewed = await accessRequests.review(
        request.id,
        "REJECTED",
        input.reviewerId,
        input.note ?? null,
        now(),
      );
      if (!reviewed) {
        return { ok: false, code: "NOT_FOUND", error: "Solicitação não encontrada." };
      }
      return { ok: true, request: reviewed };
    },
  };
}

export type ApprovalService = ReturnType<typeof createApprovalService>;

/** Production instance: real Prisma + the deployment's mailer. */
export const approvalService = createApprovalService({
  db: prisma,
  mailer: createInvitationMailer(),
});
