import { SaleStatus } from "@prisma/client";
import { assertOrganizationId } from "@/lib/tenant";
import { salesService } from "@/modules/sales/sales.service";
import { getPaymentProvider, type CheckoutSessionInput } from "@/modules/payments/provider";

export interface CreateCheckoutSessionInput extends CheckoutSessionInput {
  organizationId: string;
}

export async function createCheckoutSession(input: CreateCheckoutSessionInput) {
  const organizationId = assertOrganizationId(input.organizationId);
  const sale = await salesService.create({
    organizationId,
    amountCents: input.amountCents,
    quantity: input.quantity ?? 1,
    currency: input.currency ?? "BRL",
    status: SaleStatus.PENDING,
    reference: input.reference ?? `checkout-${Date.now()}`,
    productId: input.productId ?? undefined,
    creatorId: input.creatorId ?? undefined,
    campaignId: input.campaignId ?? undefined,
  });

  const provider = getPaymentProvider();
  const session = await provider.createCheckoutSession({
    ...input,
    organizationId,
    saleId: sale.id,
    amountCents: input.amountCents,
    quantity: input.quantity ?? 1,
    currency: input.currency ?? "BRL",
    metadata: {
      ...(input.metadata ?? {}),
      organizationId,
      saleId: sale.id,
    },
  });

  return {
    saleId: sale.id,
    organizationId,
    checkout: session,
  };
}
