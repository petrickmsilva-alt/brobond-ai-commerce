"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin, requireManager } from "@/lib/session";
import type { OutreachActionResult } from "@/modules/outreach/interfaces/outreach.interface";
import { generateOutreachMessage } from "@/modules/outreach/prompts/generator";
import { outboxRepository } from "@/modules/outreach/queue/outbox.repository";
import {
  createMessageSchema,
  messageTemplateSchema,
  scheduleMessageSchema,
  updateMessageSchema,
} from "@/modules/outreach/validators/outreach.validator";

const PATH = "/dashboard/outreach";

function fail(error: unknown): OutreachActionResult<never> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: "Dados inválidos.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "Você não tem permissão para executar esta ação." };
  }
  console.error("[outreach.actions]", error);
  return { ok: false, error: "Não foi possível concluir a ação." };
}

async function generationContext(
  organizationId: string,
  input: { creatorId: string; productId: string; campaignId: string; templateId: string },
) {
  const [creator, product, campaign, template, trend] = await Promise.all([
    prisma.creatorProfile.findFirst({ where: { id: input.creatorId, organizationId } }),
    prisma.product.findFirst({ where: { id: input.productId, organizationId } }),
    prisma.campaign.findFirst({ where: { id: input.campaignId, organizationId } }),
    prisma.messageTemplate.findFirst({ where: { id: input.templateId, organizationId } }),
    prisma.trendSnapshot.findFirst({
      where: { organizationId },
      orderBy: { trendScore: "desc" },
    }),
  ]);
  if (!creator || !product || !campaign || !template) {
    throw new Error("Contexto de geração não encontrado neste workspace.");
  }
  return {
    creator,
    product,
    campaign,
    template,
    trend: trend ?? { keyword: creator.niche },
  };
}

export async function generateMessageAction(
  input: unknown,
): Promise<OutreachActionResult<{ id: string }>> {
  try {
    const user = await requireManager();
    const ids = createMessageSchema
      .pick({ creatorId: true, productId: true, campaignId: true, templateId: true })
      .parse(input);
    const context = await generationContext(user.organizationId, ids);
    const generatedText = generateOutreachMessage({
      creator: context.creator,
      product: context.product,
      campaign: context.campaign,
      trend: context.trend,
      template: context.template.content,
    });
    const message = await outboxRepository.createDraft(user.organizationId, {
      ...ids,
      createdById: user.id,
      generatedText,
    });
    revalidatePath(PATH);
    return { ok: true, data: { id: message.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function regenerateMessageAction(
  id: string,
): Promise<OutreachActionResult<{ text: string }>> {
  try {
    const { organizationId } = await requireManager();
    const message = await prisma.outreachMessage.findFirst({
      where: { id, organizationId, status: { in: ["DRAFT", "READY"] } },
    });
    if (!message) throw new Error("Rascunho não encontrado.");
    const context = await generationContext(organizationId, message);
    const text = generateOutreachMessage({
      creator: context.creator,
      product: context.product,
      campaign: context.campaign,
      trend: context.trend,
      template: context.template.content,
    });
    await outboxRepository.updateDraft(organizationId, id, text);
    revalidatePath(PATH);
    return { ok: true, data: { text } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateMessageAction(input: unknown): Promise<OutreachActionResult> {
  try {
    const { organizationId } = await requireManager();
    const data = updateMessageSchema.parse(input);
    const updated = await outboxRepository.updateDraft(organizationId, data.id, data.generatedText);
    if (!updated) return { ok: false, error: "Mensagem não editável." };
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function scheduleMessageAction(input: unknown): Promise<OutreachActionResult> {
  try {
    const { organizationId } = await requireManager();
    const data = scheduleMessageSchema.parse(input);
    const updated = await outboxRepository.scheduleMessage(
      organizationId,
      data.id,
      data.scheduledFor,
    );
    if (!updated) return { ok: false, error: "Mensagem não pode ser agendada." };
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelMessageAction(id: string): Promise<OutreachActionResult> {
  try {
    const { organizationId } = await requireAdmin();
    const updated = await outboxRepository.cancelMessage(organizationId, id);
    if (!updated) return { ok: false, error: "Mensagem não pode ser cancelada." };
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function createTemplateAction(
  input: unknown,
): Promise<OutreachActionResult<{ id: string }>> {
  try {
    const { organizationId } = await requireAdmin();
    const data = messageTemplateSchema.parse(input);
    const template = await prisma.messageTemplate.create({ data: { ...data, organizationId } });
    revalidatePath(PATH);
    return { ok: true, data: { id: template.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateTemplateAction(input: unknown): Promise<OutreachActionResult> {
  try {
    const { organizationId } = await requireAdmin();
    const payload = z
      .object({ id: z.string().min(1), template: messageTemplateSchema })
      .parse(input);
    const result = await prisma.messageTemplate.updateMany({
      where: { id: payload.id, organizationId },
      data: payload.template,
    });
    if (result.count === 0) return { ok: false, error: "Template não encontrado." };
    revalidatePath(PATH);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
