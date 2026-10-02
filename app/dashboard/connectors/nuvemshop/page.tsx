import type { Metadata } from "next";
import ConnectorProviderPage from "../[provider]/page";

/** Dedicated Nuvemshop route with the same premium connector detail surface. */
export const metadata: Metadata = {
  title: "Nuvemshop — Conectores",
  description: "OAuth, catálogo, pedidos, webhooks e faturamento omnichannel da Nuvemshop.",
};

export default async function NuvemshopConnectorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return ConnectorProviderPage({
    params: Promise.resolve({ provider: "nuvemshop" }),
    searchParams,
  });
}
