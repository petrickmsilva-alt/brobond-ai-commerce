import { prisma } from "@/lib/prisma";
import { resolvePaymentProviderName } from "@/modules/payments/provider";
import { salesService } from "@/modules/sales/sales.service";

export type CommerceHealthStatus = "healthy" | "warning" | "critical";

export interface CommerceHealthSnapshot {
  provider: "mock" | "stripe";
  providerConfigured: boolean;
  webhookConfigured: boolean;
  stripeReady: boolean;
  status: CommerceHealthStatus;
  summary: Awaited<ReturnType<typeof salesService.summary>>;
  recentOrders: Awaited<ReturnType<typeof salesService.list>>;
  recommendations: string[];
}

export function evaluateCommerceHealth(
  provider: "mock" | "stripe",
  providerConfigured: boolean,
  webhookConfigured: boolean,
  hasRecentOrders: boolean,
): { status: CommerceHealthStatus; recommendations: string[]; stripeReady: boolean } {
  const stripeReady = provider === "stripe" && providerConfigured && webhookConfigured;
  const recommendations: string[] = [];

  if (provider === "mock") {
    recommendations.push(
      "Ative PAYMENT_PROVIDER=stripe e configure STRIPE_SECRET_KEY para pagamentos reais.",
    );
  }
  if (provider === "stripe" && !providerConfigured) {
    recommendations.push("Configure STRIPE_SECRET_KEY para criar sessões de checkout reais.");
  }
  if (provider === "stripe" && !webhookConfigured) {
    recommendations.push(
      "Configure STRIPE_WEBHOOK_SECRET para confirmar pagamentos automaticamente.",
    );
  }
  if (!hasRecentOrders) {
    recommendations.push("Gere o primeiro checkout para validar o end-to-end do fluxo comercial.");
  }

  let status: CommerceHealthStatus = "healthy";
  if (provider === "mock" || !providerConfigured || !webhookConfigured) {
    status = provider === "mock" ? "warning" : "critical";
  }
  if (provider === "stripe" && providerConfigured && webhookConfigured) {
    status = "healthy";
  }

  return { status, recommendations, stripeReady };
}

export async function getCommerceHealthSnapshot(
  organizationId: string,
): Promise<CommerceHealthSnapshot> {
  const provider = resolvePaymentProviderName();
  const providerConfigured =
    provider === "stripe" ? Boolean(process.env.STRIPE_SECRET_KEY?.trim()) : true;
  const webhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());

  const [summary, recentOrders] = await Promise.all([
    salesService.summary(organizationId),
    salesService.list(organizationId, { take: 5 }),
  ]);

  const evaluation = evaluateCommerceHealth(
    provider,
    providerConfigured,
    webhookConfigured,
    recentOrders.length > 0,
  );

  return {
    provider,
    providerConfigured,
    webhookConfigured,
    stripeReady: evaluation.stripeReady,
    status: evaluation.status,
    summary,
    recentOrders,
    recommendations: evaluation.recommendations,
  };
}
