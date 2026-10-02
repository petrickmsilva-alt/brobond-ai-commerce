import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { UserRole, type ConnectorPlatform, type Sale } from "@prisma/client";
import {
  AlertTriangle,
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  CopyCheck,
  DownloadCloud,
  ExternalLink,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableEmptyState } from "@/components/ui/table-empty-state";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ConnectorsGrid } from "@/components/dashboard/connectors-grid";
import { ContentTable } from "@/components/connectors/content-table";
import { requireOrganization, requireUser } from "@/lib/session";
import { isAdmin } from "@/lib/rbac";
import { formatCurrency } from "@/lib/utils";
import { toExternalContentPageDTO } from "@/modules/connectors/core/connector.dto";
import { connectorRepository } from "@/modules/connectors/core/connector.repository";
import { marketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import {
  CONNECTOR_PROVIDER_DESCRIPTIONS,
  CONNECTOR_PROVIDER_LABELS,
  connectorConnectLabel,
  connectorProviderFromSlug,
  type ConnectorProviderName,
} from "@/modules/marketplace/core/providers";
import { saleChannelFromConnectorProvider } from "@/modules/sales/sales-channel";
import { salesService } from "@/modules/sales/sales.service";

/**
 * Isolated connector detail screen (PR014 — Hub Multicanal).
 *
 * `/dashboard/connectors/[provider]` renders EXACTLY ONE platform — its
 * connection card (credentials, status, ADMIN actions), its sync + revenue
 * KPIs, its recent webhook inbox events and its channel sales — never the
 * stacked list of every provider. The slug registry
 * (`connectorProviderFromSlug`) is the single source of truth shared with
 * the sidebar links and the OAuth callbacks: `mercado-livre`, `shopee`,
 * `mercado-pago`, `tiktok` and `instagram` all resolve here; anything else
 * renders the 404 page (`notFound()`).
 *
 * PR016 — this screen is a pure Server Component: every child that needs
 * interactivity receives only serializable props. Its empty states pass the
 * STRING identifier `iconName` (resolved to the lucide icon inside the
 * `TableEmptyState` Client Component) — passing the icon component itself
 * (`icon={Inbox}`) is what produced the global error screen, because
 * functions cannot cross the server→client boundary.
 *
 * RBAC mirrors the hub: ADMIN manages, everyone authenticated reads (the
 * server actions re-check `requireAdmin()` on every mutation).
 */

const CONTENT_PREVIEW_PAGE_SIZE = 8;

const SALE_STATUS_LABELS: Record<Sale["status"], string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  REFUNDED: "Reembolsado",
  CANCELLED: "Cancelado",
};

const SALE_STATUS_TONES: Record<Sale["status"], "success" | "warning" | "neutral"> = {
  PENDING: "warning",
  PAID: "success",
  REFUNDED: "neutral",
  CANCELLED: "neutral",
};

function formatDateTime(value: Date | string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    typeof value === "string" ? new Date(value) : value,
  );
}

/**
 * Turn the sanitized `?reason=` token emitted by an OAuth callback into an
 * instruction an operator can act on (PR016.1). Unknown/absent tokens fall
 * back to the generic message, so a future provider never leaks a payload.
 */
function oauthErrorMessage(provider: ConnectorProviderName, reason: string | undefined): string {
  const label = CONNECTOR_PROVIDER_LABELS[provider];
  switch (reason) {
    case "denied":
      return `A autorização em ${label} foi cancelada. Use "${connectorConnectLabel(provider)}" para tentar novamente e conceda as permissões solicitadas.`;
    case "state":
      return `A sessão de autorização de ${label} expirou antes da conclusão (o link é válido por 10 minutos e de uso único). Use "${connectorConnectLabel(provider)}" para iniciar uma nova conexão.`;
    case "config":
      return `A integração com ${label} está incompleta no servidor. Confirme as variáveis do aplicativo (client id, client secret e a URL de redirecionamento) no ambiente da Render e tente novamente.`;
    case "exchange":
      return `${label} recusou a troca do código de autorização. A causa mais comum é a URL de redirecionamento registrada no painel do desenvolvedor estar diferente de APP_URL/NEXTAUTH_URL — confira os valores registrados no log do servidor e tente novamente.`;
    case "invalid_request":
      return `O retorno de ${label} chegou incompleto. Use "${connectorConnectLabel(provider)}" para iniciar a conexão novamente.`;
    default:
      return `Não foi possível conectar ${label}. Verifique as credenciais do aplicativo e tente novamente.`;
  }
}

interface ConnectorProviderPageProps {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ConnectorProviderPageProps): Promise<Metadata> {
  const { provider: slug } = await params;
  const provider = connectorProviderFromSlug(slug);
  return {
    title: provider ? `${CONNECTOR_PROVIDER_LABELS[provider]} — Conectores` : "Conectores",
  };
}

export default async function ConnectorProviderPage({
  params,
  searchParams,
}: ConnectorProviderPageProps) {
  const { provider: slug } = await params;
  const provider = connectorProviderFromSlug(slug);
  if (!provider) notFound();

  const user = await requireUser();
  const organizationId = await requireOrganization();

  // The enums are 1:1 by design — a connector provider IS a framework
  // platform and a sale channel (see `modules/sales/sales-channel.ts`).
  const platform = provider as ConnectorPlatform;
  const channel = saleChannelFromConnectorProvider(provider);

  const [cards, contentPage, recentEvents, channelSummary, recentSales, raw] = await Promise.all([
    marketplaceService.listConnectorCards(organizationId),
    connectorRepository.listContent(organizationId, {
      platform,
      page: 1,
      pageSize: CONTENT_PREVIEW_PAGE_SIZE,
      sort: "createdAt",
      order: "desc",
    }),
    marketplaceRepository.listRecentEvents(organizationId, provider, 6),
    salesService.summaryByChannel(organizationId),
    salesService.list(organizationId, { channel, take: 6 }),
    searchParams,
  ]);

  const card = cards.find((connector) => connector.provider === provider) ?? null;
  if (!card) notFound();

  const channelStats =
    channelSummary.find((summary) => summary.channel === (channel as Sale["channel"])) ?? null;
  const content = toExternalContentPageDTO(
    contentPage.items,
    1,
    CONTENT_PREVIEW_PAGE_SIZE,
    contentPage.total,
  );

  const canManage = isAdmin(user.role);
  const isMember = user.role === UserRole.MEMBER;

  // OAuth feedback banner (set by the provider callback redirects, which
  // land on this screen since PR014). `reason` is the sanitized failure
  // token added in PR016.1 — never a provider payload.
  const oauthResult = typeof raw.oauth === "string" ? raw.oauth : undefined;
  const oauthReason = typeof raw.reason === "string" ? raw.reason : undefined;

  // An OAuth2 channel with no usable credential (never connected, expired or
  // errored): the screen leads with the action that fixes it.
  const needsAuthorization = card.authType === "oauth2" && !card.connected;

  return (
    <>
      <Link
        href="/dashboard/connectors"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-white/50 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar ao hub de conectores
      </Link>

      <PageHeader
        eyebrow="Canais de Venda"
        title={CONNECTOR_PROVIDER_LABELS[provider]}
        description={CONNECTOR_PROVIDER_DESCRIPTIONS[provider]}
        actions={
          provider === "TIKTOK" ? (
            <Link
              href="/dashboard/tiktok"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-300 transition-colors hover:text-brand-200"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Dashboard completo do TikTok
            </Link>
          ) : undefined
        }
      />

      {oauthResult === "connected" && (
        <p
          role="status"
          className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        >
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          {`${CONNECTOR_PROVIDER_LABELS[provider]} conectado com sucesso. As credenciais foram criptografadas e já podem sincronizar.`}
        </p>
      )}
      {oauthResult === "error" && (
        <p
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {oauthErrorMessage(provider, oauthReason)}
        </p>
      )}

      {/* Durable authorization state — survives the reload the OAuth banner
          does not. An OAuth2 channel without a live credential always shows
          the next action here (PR016.1). */}
      {needsAuthorization && oauthResult !== "error" && (
        <p
          role="status"
          className="mb-6 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {card.status === "DISCONNECTED"
              ? `${CONNECTOR_PROVIDER_LABELS[provider]} ainda não foi autorizado neste workspace. Use "${connectorConnectLabel(provider)}" no card abaixo — o painel não consulta a API sem um token válido.`
              : `A autorização de ${CONNECTOR_PROVIDER_LABELS[provider]} não está mais válida. Use "${connectorConnectLabel(provider, true)}" no card abaixo para reautenticar o canal.`}
            {card.lastError && (
              <span className="mt-1 block text-xs text-amber-200/60">{card.lastError}</span>
            )}
          </span>
        </p>
      )}

      {/* The ONE connector: connection, credentials, status and actions —
          nothing from any other platform is rendered on this screen. */}
      <ConnectorsGrid connectors={[card]} canManage={canManage} detailLinks={false} />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Importados" value={String(card.importedCount)} icon={DownloadCloud} />
        <KpiCard label="Duplicados" value={String(card.duplicatedCount)} icon={CopyCheck} />
        <KpiCard label="Falhas" value={String(card.failedCount)} icon={AlertTriangle} />
        <KpiCard
          label="Receita paga do canal"
          value={formatCurrency(channelStats?.revenueCents ?? 0)}
          icon={Wallet}
        />
        <KpiCard
          label="Vendas pagas"
          value={String(channelStats?.paidCount ?? 0)}
          icon={CircleCheck}
        />
      </div>

      <div className="mb-8 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-white/70">Vendas do canal</h2>
              <Link
                href="/dashboard/orders"
                className="text-xs font-medium text-brand-300 transition-colors hover:text-brand-200"
              >
                Ver pedidos
              </Link>
            </div>
            {recentSales.length === 0 ? (
              /* PR016 — `iconName`, never `icon={Wallet}`: this screen is a
               * Server Component and a lucide icon is a function reference,
               * which can never cross the server→client boundary into
               * `TableEmptyState` (that was the "Functions cannot be passed
               * directly to Client Components" crash). The Client Component
               * resolves the identifier to the icon itself. */
              <TableEmptyState
                iconName="wallet"
                title="Nenhuma venda registrada"
                description={`Assim que um pedido ou pagamento de ${CONNECTOR_PROVIDER_LABELS[provider]} for confirmado, a venda aparece aqui — ingerida pelo worker financeiro.`}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido externo</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentSales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell className="font-mono text-xs text-white/70">
                        {sale.externalOrderId ?? sale.reference}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatCurrency(sale.amountCents, sale.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge tone={SALE_STATUS_TONES[sale.status]}>
                          {SALE_STATUS_LABELS[sale.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-white/50">
                        {formatDateTime(sale.occurredAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-white/70">Webhooks — eventos recentes</h2>
              <span className="rounded-md border border-surface-700/60 px-2 py-0.5 font-mono text-[10px] text-white/40">
                /api/webhooks/{slug}
              </span>
            </div>
            {recentEvents.length === 0 ? (
              <TableEmptyState
                iconName="inbox"
                title="Nenhum evento recebido"
                description="Cadastre a URL de notificação da plataforma. Entregas são verificadas, resolvidas por tenant e processadas em segundo plano pelo worker."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tópico</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Recebido</TableHead>
                    <TableHead>Processamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{event.topic ?? "—"}</TableCell>
                      <TableCell className="max-w-40 truncate font-mono text-xs text-white/50">
                        {event.externalEventId}
                      </TableCell>
                      <TableCell className="text-white/50">
                        {formatDateTime(event.createdAt)}
                      </TableCell>
                      <TableCell>
                        {event.processedAt ? (
                          <Badge tone="success">
                            <RefreshCw className="mr-1 h-3 w-3" />
                            Processado
                          </Badge>
                        ) : (
                          <Badge tone="warning">Pendente</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-white/70">Conteúdo importado desta plataforma</h2>
        <Link
          href={`/dashboard/connectors?platform=${platform}`}
          className="text-xs font-medium text-brand-300 transition-colors hover:text-brand-200"
        >
          Filtrar no hub
        </Link>
      </div>
      <Card>
        <CardContent>
          <Suspense>
            <ContentTable items={content.items} />
          </Suspense>
        </CardContent>
      </Card>

      {isMember && (
        <p className="mt-4 text-xs text-white/30">
          Somente leitura — a conexão e a sincronização de conectores são executadas por um ADMIN do
          workspace.
        </p>
      )}
    </>
  );
}
