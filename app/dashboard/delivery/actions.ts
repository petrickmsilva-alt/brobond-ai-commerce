"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin, requireManager } from "@/lib/session";
import { connectInstagram, disconnectInstagram } from "@/modules/delivery/instagram/auth.service";
import { connectWhatsApp, disconnectWhatsApp } from "@/modules/delivery/whatsapp/auth.service";
import {
  dispatchExecution,
  processDeliveryQueue,
  requeueDeliveryMessage,
} from "@/modules/delivery/queue/dispatcher";
import type { DeliveryActionResult } from "@/modules/delivery/dto";
import {
  deliveryChannelSchema,
  deliveryMessageIdSchema,
  disconnectDeliveryAccountSchema,
  sendDeliverySchema,
} from "@/modules/delivery/validators";

/**
 * Delivery server actions (PR010 §10 — RBAC):
 *   ADMIN   → connect / disconnect / reprocess
 *   MANAGER → send (enqueue + dispatch) / view
 *   MEMBER  → read-only (no action below succeeds)
 */

const PATH = "/dashboard/delivery";

function fail(error: unknown): DeliveryActionResult<never> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: "Dados inválidos.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  if (error instanceof AuthorizationError) {
    return {
      ok: false,
      error:
        error.status === 401
          ? "Sessão expirada. Entre novamente."
          : "Permissão insuficiente para esta operação de entrega.",
    };
  }
  console.error("[delivery.actions]", error instanceof Error ? error.message : "unexpected error");
  return { ok: false, error: "Não foi possível concluir a operação de entrega." };
}

// ------------------------------------------------------------------
// ADMIN — connect / disconnect / reprocess
// ------------------------------------------------------------------

/** Start Instagram Business OAuth. Browser receives only the Meta dialog URL. */
export async function connectInstagramAction(): Promise<
  DeliveryActionResult<{ authorizationUrl: string }>
> {
  try {
    const user = await requireAdmin();
    const data = await connectInstagram(user.organizationId);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

/** Start WhatsApp Business Embedded Signup. */
export async function connectWhatsAppAction(): Promise<
  DeliveryActionResult<{ authorizationUrl: string }>
> {
  try {
    const user = await requireAdmin();
    const data = await connectWhatsApp(user.organizationId);
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

/** ADMIN: revoke a connected account (ciphertext destroyed immediately). */
export async function disconnectDeliveryAccountAction(
  input: unknown,
): Promise<DeliveryActionResult<{ disconnected: boolean }>> {
  try {
    const user = await requireAdmin();
    const { accountPk } = disconnectDeliveryAccountSchema.parse(input);
    const channel = deliveryChannelSchema.parse((input as { channel?: unknown })?.channel);
    const disconnected =
      channel === "INSTAGRAM"
        ? await disconnectInstagram(user.organizationId, accountPk)
        : await disconnectWhatsApp(user.organizationId, accountPk);
    revalidatePath(PATH);
    return disconnected
      ? { ok: true, data: { disconnected: true } }
      : { ok: false, error: "Conta de entrega não encontrada neste workspace." };
  } catch (error) {
    return fail(error);
  }
}

/** ADMIN: reprocess a FAILED/CANCELLED message (fresh retry budget). */
export async function reprocessDeliveryAction(
  input: unknown,
): Promise<DeliveryActionResult<{ requeued: boolean }>> {
  try {
    const user = await requireAdmin();
    const { messageId } = deliveryMessageIdSchema.parse(input);
    const { requeued } = await requeueDeliveryMessage(user.organizationId, messageId);
    revalidatePath(PATH);
    return requeued
      ? { ok: true, data: { requeued: true } }
      : { ok: false, error: "Mensagem não encontrada neste workspace." };
  } catch (error) {
    return fail(error);
  }
}

// ------------------------------------------------------------------
// MANAGER+ — send / dispatch
// ------------------------------------------------------------------

function generateExecutionId(): string {
  return `manual-${randomUUID()}`;
}

/** MANAGER+: queue one message and attempt immediate dispatch. */
export async function sendDeliveryAction(
  input: unknown,
): Promise<DeliveryActionResult<{ messageId: string; status: string }>> {
  try {
    const user = await requireManager();
    const parsed = sendDeliverySchema.parse(input);
    const enqueued = await dispatchExecution({
      organizationId: user.organizationId,
      executionId: generateExecutionId(),
      status: "APPROVED",
      channel: parsed.channel,
      recipientId: parsed.recipientId,
      recipientName: parsed.recipientName ?? null,
      campaignId: parsed.campaignId ?? null,
      campaignName: parsed.campaignName ?? null,
      message: parsed.message,
    });
    await processDeliveryQueue(user.organizationId, { limit: 10 });
    revalidatePath(PATH);
    return { ok: true, data: { messageId: enqueued.messageId, status: enqueued.status } };
  } catch (error) {
    return fail(error);
  }
}

/** MANAGER+: drain the due queue slice for this tenant (worker trigger). */
export async function dispatchQueueAction(): Promise<
  DeliveryActionResult<{ sent: number; retries: number; failed: number }>
> {
  try {
    const user = await requireManager();
    const result = await processDeliveryQueue(user.organizationId, { limit: 50 });
    revalidatePath(PATH);
    return {
      ok: true,
      data: { sent: result.sent, retries: result.retries, failed: result.failed },
    };
  } catch (error) {
    return fail(error);
  }
}
