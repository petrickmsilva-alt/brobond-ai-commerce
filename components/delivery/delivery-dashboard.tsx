"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Instagram, Loader2, MessageCircle, Play, RotateCcw, Send, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  connectInstagramAction,
  connectWhatsAppAction,
  disconnectDeliveryAccountAction,
  dispatchQueueAction,
  reprocessDeliveryAction,
  sendDeliveryAction,
} from "@/app/dashboard/delivery/actions";
import type { UserRole } from "@prisma/client";
import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_STATUS_LABELS,
  type DeliveryChannelName,
  type DeliveryStatusName,
} from "@/modules/delivery/core/delivery.interface";
import type {
  DeliveryDashboardDTO,
  DeliveryMessageDTO,
  DeliveryMessagePageDTO,
} from "@/modules/delivery/dto";
import type { DeliveryFiltersInput } from "@/modules/delivery/validators";

const statusTone: Record<DeliveryStatusName, "success" | "warning" | "neutral" | "brand"> = {
  READ: "success",
  DELIVERED: "success",
  SENT: "brand",
  SENDING: "warning",
  QUEUED: "warning",
  DRAFT: "neutral",
  FAILED: "warning",
  CANCELLED: "neutral",
};

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
        new Date(value),
      )
    : "—";
}

function formatLatency(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min`;
}

function filterQuery(filters: DeliveryFiltersInput, page: number): string {
  const params = new URLSearchParams();
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.status) params.set("status", filters.status);
  if (filters.campaignId) params.set("campaignId", filters.campaignId);
  params.set("page", String(page));
  return params.toString();
}

export function DeliveryDashboard({
  data,
  messages,
  filters,
  role,
  oauth,
}: {
  data: DeliveryDashboardDTO;
  messages: DeliveryMessagePageDTO;
  filters: DeliveryFiltersInput;
  role: UserRole;
  oauth?: string;
}) {
  const router = useRouter();
  const isAdmin = role === "ADMIN";
  const canSend = isAdmin || role === "MANAGER";

  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(
    oauth === "connected"
      ? "Conta conectada com sucesso."
      : oauth === "error"
        ? "Não foi possível concluir a autorização. Tente conectar novamente."
        : null,
  );

  const [channelFilter, setChannelFilter] = useState(filters.channel ?? "");
  const [statusFilter, setStatusFilter] = useState(filters.status ?? "");
  const [campaignFilter, setCampaignFilter] = useState(filters.campaignId ?? "");

  const [sendChannel, setSendChannel] = useState<DeliveryChannelName>("WHATSAPP");
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendName, setSendName] = useState("");
  const [sendText, setSendText] = useState("");

  function run(action: () => Promise<{ ok: boolean; error?: string } & { data?: unknown }>) {
    setFeedback(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setFeedback(result.error ?? "Operação não concluída.");
        return;
      }
      router.refresh();
    });
  }

  function connectInstagram() {
    setFeedback(null);
    startTransition(async () => {
      const result = await connectInstagramAction();
      if (!result.ok) {
        setFeedback(result.error);
        return;
      }
      // OAuth redirects away before any credential reaches the client.
      window.location.assign(result.data.authorizationUrl);
    });
  }

  function connectWhatsApp() {
    setFeedback(null);
    startTransition(async () => {
      const result = await connectWhatsAppAction();
      if (!result.ok) {
        setFeedback(result.error);
        return;
      }
      window.location.assign(result.data.authorizationUrl);
    });
  }

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    router.push(
      `/dashboard/delivery?${filterQuery(
        {
          ...filters,
          channel: (channelFilter || undefined) as DeliveryFiltersInput["channel"],
          status: (statusFilter || undefined) as DeliveryFiltersInput["status"],
          campaignId: campaignFilter || undefined,
        },
        1,
      )}`,
    );
  }

  function sendMessage() {
    run(async () => {
      const result = await sendDeliveryAction({
        channel: sendChannel,
        recipientId: sendRecipient,
        recipientName: sendName || undefined,
        message: { type: "text", text: sendText },
      });
      if (result.ok) {
        setSendRecipient("");
        setSendName("");
        setSendText("");
        setFeedback("Mensagem enfileirada — o dispatcher já processou a tentativa atual.");
        return { ok: true as const, data: undefined };
      }
      return result;
    });
  }

  const connectedAccounts = data.accounts.filter((account) => account.status === "CONNECTED");

  return (
    <div className="space-y-6">
      {feedback && (
        <div className="rounded-lg border border-surface-600 bg-surface-800/60 px-4 py-3 text-sm text-white/80">
          {feedback}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Instagram className="h-4 w-4 text-brand-300" /> Instagram Business
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.accounts
              .filter((account) => account.channel === "INSTAGRAM")
              .map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between rounded-lg border border-surface-700 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-white">
                      {account.accountName ?? account.accountId}
                    </p>
                    <p className="text-xs text-white/40">
                      expira {formatDate(account.expiresAt)} ·{" "}
                      <Badge tone={account.status === "CONNECTED" ? "success" : "neutral"}>
                        {account.status}
                      </Badge>
                    </p>
                  </div>
                  {isAdmin && account.status === "CONNECTED" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          disconnectDeliveryAccountAction({
                            accountPk: account.id,
                            channel: "INSTAGRAM",
                          }),
                        )
                      }
                    >
                      <Unplug className="mr-1 h-3.5 w-3.5" /> Desconectar
                    </Button>
                  )}
                </div>
              ))}
            {data.accounts.filter((account) => account.channel === "INSTAGRAM").length === 0 && (
              <p className="text-sm text-white/40">Nenhuma conta Instagram conectada.</p>
            )}
            {isAdmin && (
              <Button onClick={connectInstagram} disabled={pending} size="sm">
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Conectar Instagram
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4 text-brand-300" /> WhatsApp Business
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.accounts
              .filter((account) => account.channel === "WHATSAPP")
              .map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between rounded-lg border border-surface-700 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-white">
                      {account.accountName ?? account.accountId}
                    </p>
                    <p className="text-xs text-white/40">
                      sender {account.accountId} ·{" "}
                      <Badge tone={account.status === "CONNECTED" ? "success" : "neutral"}>
                        {account.status}
                      </Badge>
                    </p>
                  </div>
                  {isAdmin && account.status === "CONNECTED" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          disconnectDeliveryAccountAction({
                            accountPk: account.id,
                            channel: "WHATSAPP",
                          }),
                        )
                      }
                    >
                      <Unplug className="mr-1 h-3.5 w-3.5" /> Desconectar
                    </Button>
                  )}
                </div>
              ))}
            {data.accounts.filter((account) => account.channel === "WHATSAPP").length === 0 && (
              <p className="text-sm text-white/40">Nenhum número WhatsApp conectado.</p>
            )}
            {isAdmin && (
              <Button onClick={connectWhatsApp} disabled={pending} size="sm">
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Conectar WhatsApp
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {canSend && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4 text-brand-300" /> Envio manual & fila
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              <Select
                value={sendChannel}
                onChange={(event) => setSendChannel(event.target.value as DeliveryChannelName)}
                aria-label="Canal de envio"
              >
                <option value="WHATSAPP">WhatsApp Business</option>
                <option value="INSTAGRAM">Instagram Business</option>
              </Select>
              <Input
                placeholder={sendChannel === "WHATSAPP" ? "Telefone (E.164)" : "IG-scoped user id"}
                value={sendRecipient}
                onChange={(event) => setSendRecipient(event.target.value)}
              />
              <Input
                placeholder="Nome do destinatário (opcional)"
                value={sendName}
                onChange={(event) => setSendName(event.target.value)}
              />
              <Input
                placeholder="Mensagem de texto"
                value={sendText}
                onChange={(event) => setSendText(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pending || !sendRecipient.trim() || !sendText.trim()}
                onClick={sendMessage}
              >
                <Send className="mr-1 h-3.5 w-3.5" /> Enviar agora
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await dispatchQueueAction();
                    if (result.ok) {
                      setFeedback(
                        `Fila processada: ${result.data.sent} enviadas · ${result.data.retries} reagendadas · ${result.data.failed} falhas.`,
                      );
                      return { ok: true as const, data: undefined };
                    }
                    return result;
                  })
                }
              >
                <Play className="mr-1 h-3.5 w-3.5" /> Processar fila
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={applyFilters} className="grid gap-3 md:grid-cols-4">
            <Select
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              aria-label="Filtrar por canal"
            >
              <option value="">Todos os canais</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="WHATSAPP">WhatsApp</option>
            </Select>
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filtrar por status"
            >
              <option value="">Todos os status</option>
              {Object.entries(DELIVERY_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              value={campaignFilter}
              onChange={(event) => setCampaignFilter(event.target.value)}
              aria-label="Filtrar por campanha"
            >
              <option value="">Todas as campanhas</option>
              {data.campaigns.map((campaign) => (
                <option key={campaign.campaignId} value={campaign.campaignId}>
                  {campaign.campaignName ?? campaign.campaignId}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" variant="ghost" className="self-center">
              Aplicar filtros
            </Button>
          </form>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/60">
          Mensagens ({messages.total})
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mensagem</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Creator</TableHead>
              <TableHead>Campanha</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tentativas</TableHead>
              <TableHead>Tempo de entrega</TableHead>
              {isAdmin && <TableHead className="text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {messages.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 8 : 7} className="py-8 text-center text-white/40">
                  Nenhuma mensagem encontrada para os filtros selecionados.
                </TableCell>
              </TableRow>
            )}
            {messages.rows.map((row: DeliveryMessageDTO) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-70">
                  <div className="truncate font-medium text-white">{row.messagePreview ?? "—"}</div>
                  <div className="mt-0.5 text-xs text-white/40">
                    {row.recipientName ?? row.recipientId} · {formatDate(row.createdAt)}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge tone="brand">
                    {DELIVERY_CHANNEL_LABELS[row.channel as DeliveryChannelName]}
                  </Badge>
                </TableCell>
                <TableCell>{row.creatorName ?? "—"}</TableCell>
                <TableCell>{row.campaignName ?? "—"}</TableCell>
                <TableCell>
                  <Badge tone={statusTone[row.status as DeliveryStatusName]}>
                    {DELIVERY_STATUS_LABELS[row.status as DeliveryStatusName]}
                  </Badge>
                  {row.lastError && (
                    <div className="mt-1 max-w-55 truncate text-xs text-amber-300/80">
                      {row.lastError}
                    </div>
                  )}
                </TableCell>
                <TableCell>{row.attempts}</TableCell>
                <TableCell>{formatLatency(row.deliveryLatencyMs)}</TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    {(row.status === "FAILED" || row.status === "CANCELLED") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const result = await reprocessDeliveryAction({ messageId: row.id });
                            if (result.ok) {
                              setFeedback(
                                "Mensagem recolocada na fila com novo orçamento de tentativas.",
                              );
                              return { ok: true as const, data: undefined };
                            }
                            return result;
                          })
                        }
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reprocessar
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {messages.totalPages > 1 && (
          <div className="mt-3 flex items-center justify-end gap-3 text-sm text-white/50">
            {filters.page > 1 && (
              <a
                className="text-brand-300 hover:underline"
                href={`/dashboard/delivery?${filterQuery(filters, filters.page - 1)}`}
              >
                ← Anterior
              </a>
            )}
            <span>
              Página {filters.page} de {messages.totalPages}
            </span>
            {filters.page < messages.totalPages && (
              <a
                className="text-brand-300 hover:underline"
                href={`/dashboard/delivery?${filterQuery(filters, filters.page + 1)}`}
              >
                Próxima →
              </a>
            )}
          </div>
        )}
      </section>

      {connectedAccounts.length > 0 && data.logs.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/60">
            Auditoria recente
          </h2>
          <ul className="space-y-1 text-sm text-white/60">
            {data.logs.map((log) => (
              <li key={log.id} className="flex justify-between gap-4">
                <span className="font-mono text-xs">{log.action}</span>
                <span className="text-xs text-white/30">{formatDate(log.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
