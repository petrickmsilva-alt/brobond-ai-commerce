import { z } from "zod";
import Stripe from "stripe";

export type PaymentProviderName = "stripe" | "mock";

export interface CheckoutSessionInput {
  organizationId: string;
  saleId?: string;
  amountCents: number;
  currency?: string;
  quantity?: number;
  productName?: string;
  customerEmail?: string;
  reference?: string;
  productId?: string | null;
  creatorId?: string | null;
  campaignId?: string | null;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  id: string;
  provider: PaymentProviderName;
  status: "open" | "paid" | "pending";
  url?: string | null;
  amountCents: number;
  currency: string;
  clientReferenceId?: string;
}

export interface PaymentProvider {
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
}

export const checkoutCreateSchema = z.object({
  amountCents: z.coerce.number().int().positive(),
  currency: z.string().trim().default("BRL"),
  quantity: z.coerce.number().int().min(1).default(1),
  productName: z.string().trim().min(1).optional(),
  customerEmail: z.string().trim().email().optional(),
  reference: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional().nullable(),
  creatorId: z.string().trim().min(1).optional().nullable(),
  campaignId: z.string().trim().min(1).optional().nullable(),
  successUrl: z.string().trim().url().optional(),
  cancelUrl: z.string().trim().url().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
});

export function normalizePaymentCurrency(currency?: string | null): string {
  const value = currency?.trim();
  if (!value) return "BRL";
  const normalized = value.toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "BRL";
}

export class MockPaymentProvider implements PaymentProvider {
  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const id = `mock_${crypto.randomUUID()}`;
    const currency = normalizePaymentCurrency(input.currency);
    return {
      id,
      provider: "mock",
      status: "pending",
      url: `https://example.com/checkout/${id}`,
      amountCents: input.amountCents,
      currency,
      clientReferenceId: input.saleId ?? input.reference,
    };
  }
}

export class StripePaymentProvider implements PaymentProvider {
  constructor(private readonly stripe: Stripe) {}

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const currency = normalizePaymentCurrency(input.currency);
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: Math.max(1, Number(input.quantity ?? 1) || 1),
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: Math.max(0, Number(input.amountCents ?? 0) || 0),
            product_data: {
              name: input.productName?.trim() || "Brobond order",
            },
          },
        },
      ],
      success_url:
        input.successUrl ??
        `${process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/dashboard/orders?checkout=success`,
      cancel_url:
        input.cancelUrl ??
        `${process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/dashboard/orders?checkout=cancelled`,
      customer_email: input.customerEmail || undefined,
      metadata: {
        ...(input.metadata ?? {}),
        organizationId: input.organizationId,
        saleId: input.saleId ?? input.reference ?? "",
      },
      client_reference_id: input.saleId ?? input.reference,
    });

    return {
      id: session.id,
      provider: "stripe",
      status: session.payment_status === "paid" ? "paid" : "open",
      url: session.url ?? null,
      amountCents: input.amountCents,
      currency,
      clientReferenceId: input.saleId ?? input.reference,
    };
  }
}

export function resolvePaymentProviderName(env: NodeJS.ProcessEnv = process.env): PaymentProviderName {
  const provider = env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (provider === "stripe") return "stripe";
  if (provider === "mock") return "mock";
  return env.STRIPE_SECRET_KEY?.trim() ? "stripe" : "mock";
}

export function getPaymentProvider(): PaymentProvider {
  const providerName = resolvePaymentProviderName();

  if (providerName === "stripe") {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) return new MockPaymentProvider();
    return new StripePaymentProvider(new Stripe(key));
  }

  return new MockPaymentProvider();
}
