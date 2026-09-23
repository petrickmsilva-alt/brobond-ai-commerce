import "server-only";

import type { AccessRequest, AccessRequestStatus, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AccessRequestData } from "@/lib/validations/auth";

/**
 * Access-request domain (PR010.2 §5).
 *
 * WHAT THIS IS
 * ------------
 * The queue behind the public "Solicitar acesso" form. A row here is a *lead*,
 * not an account: it has no password, no role and no tenant, and nothing in
 * the authentication path ever reads it. Approving one only unlocks an ADMIN
 * to send an `Invitation`, which is the single code path that creates a
 * `User`. The PR000.2 "no public sign-up" contract is therefore preserved.
 *
 * WHY IT IS NOT TENANT-SCOPED
 * ---------------------------
 * The requester has no tenant yet — that is the whole point of the request.
 * `AccessRequest` is consequently the only model in the schema without an
 * `organizationId`, and the only one an unauthenticated visitor can write.
 * Reading the queue is gated at the call site by `requireAdmin()` (§11).
 *
 * ABUSE CONTROL
 * -------------
 * `submit()` is idempotent per pending email: a visitor who submits the form
 * five times updates one PENDING row instead of creating five. That keeps a
 * scripted flood from turning the ADMIN queue into a denial-of-service
 * without needing to remember anything about the caller.
 */

export type AccessRequestDatabase = Pick<PrismaClient, "accessRequest">;

/** Row shape exposed to the UI. Mirrors the model — it holds no secret. */
export interface AccessRequestView {
  id: string;
  name: string;
  company: string;
  email: string;
  whatsapp: string | null;
  message: string | null;
  status: AccessRequestStatus;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface AccessRequestCounts {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

function toView(row: AccessRequest): AccessRequestView {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    whatsapp: row.whatsapp,
    message: row.message,
    status: row.status,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

export function createAccessRequestService(db: AccessRequestDatabase) {
  return {
    /**
     * Record a public access request.
     *
     * Idempotent per email while a request is still PENDING: re-submitting
     * refreshes the existing row rather than queueing a duplicate.
     */
    async submit(data: AccessRequestData): Promise<AccessRequestView> {
      const existing = await db.accessRequest.findFirst({
        where: { email: data.email, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });

      if (existing) {
        const updated = await db.accessRequest.update({
          where: { id: existing.id },
          data: {
            name: data.name,
            company: data.company,
            whatsapp: data.whatsapp,
            message: data.message,
          },
        });
        return toView(updated);
      }

      const created = await db.accessRequest.create({
        data: {
          name: data.name,
          company: data.company,
          email: data.email,
          whatsapp: data.whatsapp,
          message: data.message,
          status: "PENDING",
        },
      });
      return toView(created);
    },

    /** List requests for the ADMIN queue, newest first. */
    async list(options: { status?: AccessRequestStatus; take?: number } = {}) {
      const rows = await db.accessRequest.findMany({
        where: options.status ? { status: options.status } : undefined,
        orderBy: { createdAt: "desc" },
        take: options.take ?? 50,
      });
      return rows.map(toView);
    },

    /** Status counters for the Configurações badge. */
    async counts(): Promise<AccessRequestCounts> {
      const [pending, approved, rejected, total] = await Promise.all([
        db.accessRequest.count({ where: { status: "PENDING" } }),
        db.accessRequest.count({ where: { status: "APPROVED" } }),
        db.accessRequest.count({ where: { status: "REJECTED" } }),
        db.accessRequest.count(),
      ]);
      return { pending, approved, rejected, total };
    },

    /**
     * Record an ADMIN decision.
     *
     * Approving does NOT create a user or send anything — it marks the lead as
     * cleared so an ADMIN can invite them. Keeping the two steps separate
     * means an accidental click can never provision access.
     */
    async review(
      id: string,
      decision: Extract<AccessRequestStatus, "APPROVED" | "REJECTED">,
      reviewerId: string,
      note: string | null = null,
      now: Date = new Date(),
    ): Promise<AccessRequestView | null> {
      const existing = await db.accessRequest.findUnique({ where: { id } });
      if (!existing) return null;

      const updated = await db.accessRequest.update({
        where: { id },
        data: {
          status: decision,
          reviewNote: note,
          reviewedAt: now,
          reviewedBy: reviewerId,
        },
      });
      return toView(updated);
    },
  };
}

export type AccessRequestService = ReturnType<typeof createAccessRequestService>;

/** Production instance bound to the shared Prisma client. */
export const accessRequestService = createAccessRequestService(prisma);
