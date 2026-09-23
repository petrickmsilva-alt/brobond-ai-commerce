import "server-only";

import type { Invitation, InvitationStatus, PrismaClient, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";
import { hashPassword } from "@/lib/password";
import { generateToken, hashToken, invitationExpiry, isExpired } from "@/lib/tokens";

/**
 * Invitation domain (PR010.2 §7).
 *
 * THE ONLY PATH THAT CREATES A USER
 * ---------------------------------
 * There is still no public sign-up. An ADMIN issues an invitation bound to a
 * tenant and a role; the invitee redeems it once, sets a password, and only
 * then does a `User` row exist. Both halves of that sentence are enforced
 * here rather than in the UI.
 *
 * SECURITY CONTRACT
 * -----------------
 * - The raw token is returned to the caller EXACTLY once (from `create()`) so
 *   it can be put in the invite URL. Only its SHA-256 digest is persisted, so
 *   a database dump yields no usable link.
 * - The role is read from the stored invitation, never from the accept
 *   payload — an invitee cannot promote themselves to ADMIN by editing a form
 *   field.
 * - The tenant is likewise read from the invitation, so an invite can never
 *   drop a user into someone else's workspace.
 * - Acceptance is a single transaction that consumes the invitation and
 *   writes the user together: a replayed link finds `status != PENDING` and
 *   is rejected, so one invitation can never create two accounts.
 * - Every ADMIN-facing read/write is tenant-scoped through `scopedWhere()`;
 *   one workspace can never see or revoke another's invitations.
 */

export type InvitationDatabase = Pick<PrismaClient, "invitation" | "user" | "organization"> & {
  $transaction: PrismaClient["$transaction"];
};

/** Why an invitation token was refused. Never leaked verbatim to the user. */
export type InvitationRejection = "not_found" | "expired" | "revoked" | "accepted";

export class InvitationError extends Error {
  readonly reason: InvitationRejection;

  constructor(reason: InvitationRejection, message: string) {
    super(message);
    this.name = "InvitationError";
    this.reason = reason;
  }
}

/** Non-secret invitation summary for the ADMIN table. Never carries a token. */
export interface InvitationView {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  /** Derived: PENDING but past its expiry. */
  expired: boolean;
}

/** What the public `/invite/[token]` screen may know before acceptance. */
export interface InvitationPreview {
  email: string;
  name: string | null;
  role: UserRole;
  organizationName: string;
  expiresAt: Date;
}

function toView(row: Invitation, now: Date = new Date()): InvitationView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    expired: row.status === "PENDING" && isExpired(row.expiresAt, now),
  };
}

export interface CreateInvitationArgs {
  email: string;
  name?: string | null;
  role: UserRole;
  invitedBy: string;
}

export function createInvitationService(db: InvitationDatabase) {
  /**
   * Resolve a raw token to a usable invitation, or throw a typed rejection.
   * Shared by the preview (GET) and the accept (POST) paths so both agree on
   * exactly what "valid" means.
   */
  async function resolveToken(rawToken: string, now: Date = new Date()): Promise<Invitation> {
    const tokenHash = hashToken(rawToken);
    const invitation = await db.invitation.findUnique({ where: { tokenHash } });

    if (!invitation) {
      throw new InvitationError("not_found", "Convite inválido ou inexistente.");
    }
    if (invitation.status === "ACCEPTED") {
      throw new InvitationError("accepted", "Este convite já foi utilizado.");
    }
    if (invitation.status === "REVOKED") {
      throw new InvitationError("revoked", "Este convite foi revogado.");
    }
    if (isExpired(invitation.expiresAt, now)) {
      throw new InvitationError("expired", "Este convite expirou.");
    }
    return invitation;
  }

  return {
    resolveToken,

    /**
     * Issue an invitation and return the RAW token exactly once.
     *
     * Re-inviting an email that already has a PENDING invitation rotates the
     * token on the existing row (the old link stops working) instead of
     * colliding with the `(organizationId, email, status)` unique index.
     */
    async create(
      organizationId: string,
      args: CreateInvitationArgs,
      now: Date = new Date(),
    ): Promise<{ invitation: InvitationView; token: string }> {
      const { organizationId: tenant } = tenantWhere(organizationId);
      const email = args.email.trim().toLowerCase();

      // An existing member does not need an invitation.
      const existingUser = await db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingUser) {
        throw new InvitationError("accepted", "Já existe uma conta com este email.");
      }

      const token = generateToken();
      const tokenHash = hashToken(token);
      const expiresAt = invitationExpiry(now);

      const pending = await db.invitation.findFirst({
        where: scopedWhere(tenant, { email, status: "PENDING" as InvitationStatus }),
      });

      const row = pending
        ? await db.invitation.update({
            where: { id: pending.id },
            data: {
              name: args.name ?? null,
              role: args.role,
              tokenHash,
              expiresAt,
              invitedBy: args.invitedBy,
            },
          })
        : await db.invitation.create({
            data: {
              organizationId: tenant,
              email,
              name: args.name ?? null,
              role: args.role,
              tokenHash,
              expiresAt,
              status: "PENDING",
              invitedBy: args.invitedBy,
            },
          });

      return { invitation: toView(row, now), token };
    },

    /** Tenant-scoped list for the ADMIN table. Never returns a token/digest. */
    async list(organizationId: string, now: Date = new Date()): Promise<InvitationView[]> {
      const rows = await db.invitation.findMany({
        where: scopedWhere(organizationId),
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return rows.map((row) => toView(row, now));
    },

    /** Revoke a PENDING invitation. Tenant-scoped: cross-tenant ids no-op. */
    async revoke(organizationId: string, id: string): Promise<boolean> {
      const existing = await db.invitation.findFirst({
        where: scopedWhere(organizationId, { id }),
      });
      if (!existing || existing.status !== "PENDING") return false;

      await db.invitation.update({
        where: { id: existing.id },
        data: { status: "REVOKED" },
      });
      return true;
    },

    /**
     * Public preview for `/invite/[token]` — shows who was invited and to
     * which workspace, so the invitee can tell a legitimate link from a
     * phishing one. Carries no token and no password material.
     */
    async preview(rawToken: string, now: Date = new Date()): Promise<InvitationPreview> {
      const invitation = await resolveToken(rawToken, now);
      const organization = await db.organization.findUnique({
        where: { id: invitation.organizationId },
        select: { name: true },
      });

      return {
        email: invitation.email,
        name: invitation.name,
        role: invitation.role,
        organizationName: organization?.name ?? "Workspace",
        expiresAt: invitation.expiresAt,
      };
    },

    /**
     * Redeem an invitation: create the user and consume the token atomically.
     *
     * The role and tenant come from the stored invitation — NEVER from the
     * caller. Returns the credentials the caller needs to sign the user in
     * automatically (§7: "Entrar automaticamente").
     */
    async accept(
      rawToken: string,
      input: { password: string; name?: string | null },
      now: Date = new Date(),
    ): Promise<{ userId: string; email: string; organizationId: string; role: UserRole }> {
      const invitation = await resolveToken(rawToken, now);
      const passwordHash = await hashPassword(input.password);

      return db.$transaction(async (tx) => {
        // Re-read inside the transaction and consume the invitation with a
        // status-guarded update: if a concurrent request already accepted it,
        // this `updateMany` matches zero rows and we abort. That is what makes
        // a replayed link incapable of creating a second account.
        const claimed = await tx.invitation.updateMany({
          where: { id: invitation.id, status: "PENDING" },
          data: { status: "ACCEPTED", acceptedAt: now },
        });
        if (claimed.count === 0) {
          throw new InvitationError("accepted", "Este convite já foi utilizado.");
        }

        const user = await tx.user.upsert({
          where: { email: invitation.email },
          // A pre-existing account keeps its role/tenant — an invitation must
          // never silently move or re-privilege an existing user.
          update: { passwordHash, name: input.name ?? invitation.name ?? undefined },
          create: {
            email: invitation.email,
            name: input.name ?? invitation.name ?? null,
            passwordHash,
            role: invitation.role,
            organizationId: invitation.organizationId,
            emailVerified: now,
          },
          select: { id: true, email: true, organizationId: true, role: true },
        });

        return {
          userId: user.id,
          email: user.email,
          organizationId: user.organizationId,
          role: user.role,
        };
      });
    },
  };
}

export type InvitationService = ReturnType<typeof createInvitationService>;

/** Production instance bound to the shared Prisma client. */
export const invitationService = createInvitationService(prisma);
