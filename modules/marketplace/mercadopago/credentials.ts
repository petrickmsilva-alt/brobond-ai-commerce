import "server-only";

import type { Connector } from "@prisma/client";

/**
 * Server-side Mercado Pago credential resolution.
 *
 * The unified `Connector` row is always preferred. The Render environment
 * pair is only a deployment fallback for installations that provision the
 * seller credentials globally. A partial pair is deliberately treated as
 * unconfigured: the UI must never claim that an unusable connection is live.
 */
export interface MercadoPagoEnvironmentCredentials {
  accessToken: string;
  publicKey: string;
}

export interface MercadoPagoEnvironment {
  [key: string]: string | undefined;
  MERCADOPAGO_ACCESS_TOKEN?: string;
  MERCADOPAGO_PUBLIC_KEY?: string;
}

export function getMercadoPagoEnvironmentCredentials(
  env: MercadoPagoEnvironment = process.env,
): MercadoPagoEnvironmentCredentials | null {
  const accessToken = env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  const publicKey = env.MERCADOPAGO_PUBLIC_KEY?.trim();

  if (!accessToken || !publicKey) return null;
  return { accessToken, publicKey };
}

/** True only when both encrypted credentials are present in the tenant row. */
export function hasPersistedMercadoPagoCredentials(
  connector: Pick<Connector, "accessToken" | "publicKey"> | null | undefined,
): boolean {
  return Boolean(connector?.accessToken && connector.publicKey);
}
