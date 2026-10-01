"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  CircleAlert,
  CircleCheck,
  Instagram,
  KeyRound,
  Link2,
  Loader2,
  Music2,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  Unplug,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ConnectorCardDTO } from "@/modules/marketplace/core/connector.dto";
import type { ConnectionStatus } from "@/modules/marketplace/core/providers";
import {
  connectMercadoPagoAction,
  disconnectProviderAction,
  startProviderOAuthAction,
  syncProviderAction,
} from "@/app/dashboard/marketplace/actions";

/**
 * Marketplace connectors grid (PR012) — the five real provider cards.
 *
 * The server-rendered DTO avoids a disconnected flash. Once mounted, the
 * client refreshes it through `/api/connectors/status`, whose Mercado Pago
 * resolver prefers the tenant's Connector row and falls back to the protected
 * Render environment pair. No credential value is ever sent to this module.
 */

const PROVIDER_ICONS = {
  TIKTOK: Music2,
  INSTAGRAM: Instagram,
  SHOPEE: ShoppingBag,
  MERCADOLIVRE: Store,
  MERCADOPAGO: Wallet,
} as const;

const STATUS_STYLES: Record<ConnectionStatus, { label: string; className: string }> = {
  CONNECTED: {
    label: "Conectado",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  DISCONNECTED: {
    label: "Desconectado",
    className: "border-surface-600 bg-surface-800 text-white/50",
  },
  EXPIRED: {
    label: "Expirado",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
  ERROR: {
    label: "Erro",
    className: "border-red-500/30 bg-red-500/10 text-red-300",
  },
};

const LOCKED_STATUS_STYLE = {
  label: "Conectado",
  className: "border-brand-400/45 bg-brand-500/15 text-brand-100 shadow-[0_0_18px_-8px_#c79a37]",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

interface ConnectorsGridProps {
  connectors: ConnectorCardDTO[];
  canManage: boolean;
}

interface ConnectorsStatusResponse {
  ok: boolean;
  connectors?: ConnectorCardDTO[];
}

interface Feedback {
  ok: boolean;
  message: string;
}

function MarketplaceCard({
  connector,
  canManage,
  refreshStatuses,
}: {
  connector: ConnectorCardDTO;
  canManage: boolean;
  refreshStatuses: () => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showKeysForm, setShowKeysForm] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [publicKey, setPublicKey] = useState("");

  const Icon = PROVIDER_ICONS[connector.provider as keyof typeof PROVIDER_ICONS] ?? Wallet;
  const isLockedMercadoPago =
    connector.provider === "MERCADOPAGO" && connector.locked && connector.connected;
  const status = isLockedMercadoPago
    ? LOCKED_STATUS_STYLE
    : (STATUS_STYLES[connector.status] ?? STATUS_STYLES.DISCONNECTED);

  useEffect(() => {
    if (!isLockedMercadoPago) return;
    // If the API resolves durable credentials while a stale form is open,
    // remove its values immediately and keep the card in display-only mode.
    setShowKeysForm(false);
    setAccessToken("");
    setPublicKey("");
  }, [isLockedMercadoPago]);

  function connect() {
    setFeedback(null);
    if (isLockedMercadoPago) return;
    if (connector.authType === "apikeys") {
      setShowKeysForm((current) => !current);
      return;
    }
    startTransition(async () => {
      const result = await startProviderOAuthAction(connector.provider);
      if (result.ok) {
        window.location.assign(result.data.authorizationUrl);
        return;
      }
      setFeedback({ ok: false, message: result.error });
    });
  }

  function submitKeys() {
    if (isLockedMercadoPago) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await connectMercadoPagoAction({
        accessToken: accessToken.trim(),
        publicKey: publicKey.trim(),
      });
      if (result.ok) {
        setAccessToken("");
        setPublicKey("");
        setShowKeysForm(false);
        setFeedback({
          ok: true,
          message: `Conta ${result.data.shopName ?? "Mercado Pago"} conectada com credenciais de produção.`,
        });
        await refreshStatuses();
        return;
      }
      setFeedback({ ok: false, message: result.error });
    });
  }

  function sync() {
    setFeedback(null);
    startTransition(async () => {
      const result = await syncProviderAction({ provider: connector.provider });
      setFeedback(
        result.ok
          ? {
              ok: true,
              message: `${result.data.imported} importados · ${result.data.duplicated} duplicados · ${result.data.failed} falhas.`,
            }
          : { ok: false, message: result.error },
      );
      if (result.ok) await refreshStatuses();
    });
  }

  function disconnect() {
    if (isLockedMercadoPago) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await disconnectProviderAction(connector.provider);
      setFeedback(
        result.ok
          ? { ok: true, message: "Conexão revogada e credenciais removidas." }
          : { ok: false, message: result.error },
      );
      if (result.ok) await refreshStatuses();
    });
  }

  const metricClassName = isLockedMercadoPago
    ? "rounded-lg border border-brand-500/25 bg-black/35 py-2 shadow-[inset_0_1px_0_rgba(199,154,55,0.08)]"
    : "rounded-lg border border-surface-700/60 py-2";
  const metricLabelClassName = isLockedMercadoPago
    ? "text-[11px] uppercase tracking-wide text-brand-300/65"
    : "text-[11px] uppercase tracking-wide text-white/35";
  const metricValueClassName = isLockedMercadoPago
    ? "mt-0.5 text-sm font-semibold tabular-nums text-brand-100"
    : "mt-0.5 text-sm font-semibold tabular-nums text-white";

  return (
    <Card
      className={
        isLockedMercadoPago
          ? "border-brand-500/35 bg-[#090806] bg-[radial-gradient(circle_at_top_right,rgba(199,154,55,0.13),transparent_45%)] shadow-[0_14px_40px_-18px_rgba(199,154,55,0.45)]"
          : undefined
      }
    >
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={
                isLockedMercadoPago
                  ? "flex h-10 w-10 items-center justify-center rounded-lg border border-brand-500/25 bg-black/40 text-brand-300"
                  : "flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600/15 text-brand-300"
              }
            >
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p
                className={
                  isLockedMercadoPago
                    ? "text-sm font-semibold text-brand-50"
                    : "text-sm font-semibold text-white"
                }
              >
                {connector.name}
              </p>
              <p
                className={
                  isLockedMercadoPago ? "text-xs text-brand-100/45" : "text-xs text-white/40"
                }
              >
                {connector.shopName ?? connector.description}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}
          >
            {isLockedMercadoPago && <CircleCheck className="h-3 w-3" />}
            {status.label}
          </span>
        </div>

        <dl
          className="grid grid-cols-3 gap-2 text-center"
          aria-label={`Métricas de sincronização de ${connector.name}`}
        >
          <div className={metricClassName}>
            <dt className={metricLabelClassName}>Importados</dt>
            <dd className={metricValueClassName}>{connector.importedCount}</dd>
          </div>
          <div className={metricClassName}>
            <dt className={metricLabelClassName}>Duplicados</dt>
            <dd className={metricValueClassName}>{connector.duplicatedCount}</dd>
          </div>
          <div className={metricClassName}>
            <dt className={metricLabelClassName}>Falhas</dt>
            <dd className={metricValueClassName}>{connector.failedCount}</dd>
          </div>
        </dl>

        <div
          className={
            isLockedMercadoPago
              ? "space-y-1 text-xs text-brand-100/45"
              : "space-y-1 text-xs text-white/40"
          }
        >
          <p>
            Última sincronização:{" "}
            <span className={isLockedMercadoPago ? "text-brand-100/70" : "text-white/60"}>
              {formatDateTime(connector.lastSyncAt)}
            </span>
            {connector.syncCount > 0 && <span> · {connector.syncCount} execução(ões)</span>}
          </p>
          {connector.publicKeyPreview && (
            <p>
              Public key:{" "}
              <span
                className={
                  isLockedMercadoPago ? "font-mono text-brand-200/70" : "font-mono text-white/60"
                }
              >
                {connector.publicKeyPreview}
              </span>
            </p>
          )}
          {connector.lastError && (
            <p className="line-clamp-2 text-amber-300/80">{connector.lastError}</p>
          )}
        </div>

        {isLockedMercadoPago ? (
          <div className="mt-auto space-y-3">
            <div className="flex items-start gap-2.5 rounded-lg border border-brand-500/20 bg-black/30 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
              <div>
                <p className="text-xs font-medium text-brand-100">
                  Credenciais ativas e protegidas
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-brand-100/45">
                  {connector.credentialSource === "environment"
                    ? "Configuração persistida no ambiente seguro do Render."
                    : "Configuração persistida com criptografia no Connector."}
                </p>
              </div>
            </div>
            {canManage ? (
              <Button size="sm" onClick={sync} disabled={isPending} className="w-full">
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sincronizar agora
              </Button>
            ) : (
              <p className="text-xs text-brand-100/35">
                Somente leitura — a sincronização exige ADMIN.
              </p>
            )}
          </div>
        ) : canManage ? (
          <div className="mt-auto flex flex-col gap-3">
            {showKeysForm && connector.authType === "apikeys" && (
              <div className="space-y-2 rounded-lg border border-surface-700/60 p-3">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-white/40">
                  Access Token (produção)
                </label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="APP_USR-…"
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                />
                <label className="block text-[11px] font-medium uppercase tracking-wide text-white/40">
                  Public Key
                </label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="APP_USR-…"
                  value={publicKey}
                  onChange={(event) => setPublicKey(event.target.value)}
                />
                <Button
                  size="sm"
                  onClick={submitKeys}
                  disabled={isPending || !accessToken.trim() || !publicKey.trim()}
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" />
                  )}
                  Validar e conectar
                </Button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={connect} disabled={isPending}>
                <Link2 className="h-3.5 w-3.5" />
                {connector.connected ? "Reconectar" : "Conectar"}
              </Button>
              <Button size="sm" onClick={sync} disabled={isPending || !connector.connected}>
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sincronizar
              </Button>
              {connector.connected && (
                <Button size="sm" variant="ghost" onClick={disconnect} disabled={isPending}>
                  <Unplug className="h-3.5 w-3.5" />
                  Desconectar
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-auto text-xs text-white/30">
            Somente leitura — conexão e sincronização exigem ADMIN.
          </p>
        )}

        {feedback && (
          <p
            className={
              feedback.ok
                ? "flex items-start gap-1.5 text-xs text-emerald-400"
                : "flex items-start gap-1.5 text-xs text-red-400"
            }
            role="status"
          >
            {feedback.ok ? (
              <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            {feedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectorsGrid({ connectors, canManage }: ConnectorsGridProps) {
  const [resolvedConnectors, setResolvedConnectors] = useState(connectors);

  useEffect(() => {
    setResolvedConnectors(connectors);
  }, [connectors]);

  const refreshStatuses = useCallback(async () => {
    try {
      const response = await fetch("/api/connectors/status", {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as ConnectorsStatusResponse;
      if (payload.ok && Array.isArray(payload.connectors)) {
        setResolvedConnectors(payload.connectors);
      }
    } catch {
      // Keep the server-rendered state when the refresh is temporarily
      // unavailable. A later action or page load retries the safe endpoint.
    }
  }, []);

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses]);

  return (
    <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {resolvedConnectors.map((connector) => (
        <MarketplaceCard
          key={connector.provider}
          connector={connector}
          canManage={canManage}
          refreshStatuses={refreshStatuses}
        />
      ))}
    </div>
  );
}
