import { GET as handleMercadoLivreOAuthCallback } from "../../../mercadolivre/callback/route";

/**
 * Alias of the Mercado Livre OAuth callback (PR016.1).
 *
 * The canonical route is `/api/mercadolivre/callback`. This namespaced twin
 * exists because the URI registered in the Mercado Livre DevCenter is the
 * one Meli redirects to, and an application registered under the
 * `/api/connectors/…` namespace used to land on a 404: the authorization
 * succeeded, no code ever reached the exchange, and the panel kept failing
 * with "Não foi possível listar os anúncios do Mercado Livre".
 *
 * It delegates to the same handler — identical single-use state validation,
 * identical tenant resolution, no extra surface. The exchange replays the
 * redirect URI derived from THIS request, so the alias path is sent back to
 * Meli verbatim (see `mercadoLivreRedirectUriCandidates`).
 *
 * The segment config is declared literally (not re-exported): Next.js reads
 * `runtime`/`dynamic` statically and cannot follow a re-export.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleMercadoLivreOAuthCallback(request);
}
