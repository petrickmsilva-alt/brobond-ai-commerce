"use client";

import { useState, useTransition } from "react";
import {
  CircleAlert,
  CircleCheck,
  Instagram,
  KeyRound,
  Link2,
  Loader2,
  Music2,
  RefreshCw,
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
 * Marketplace connectors grid (PR012) — the five real provider cards:
 * TikTok Shop, Instagram Shopping, Shopee, Mercado Livre and Mercado Pago.
 *
 * Every button triggers a REAL call: OAuth2 redirects to the provider's
 * official authorization page, "Sincronizar" runs the live sync pipeline
 * (valid credential → official API → consolidated counters) and the
 * Mercado Pago card validates/persists production API keys. All mutations
 * re-assert `requireAdmin()` server-side.
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

interface Feedback {
  ok: boolean;
  message: string;
}

function MarketplaceCard({ connector, canManage }: { connector: ConnectorCardDTO; canManage: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showKeysForm, setShowKeysForm] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [publicKey, setPublicKey] = useState("");

  const Icon = PROVIDER_ICONS[connector.provider];
  const status = STATUS_STYLES[connector.status];

  function connect() {
    setFeedback(null);
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
    });
  }

  function disconnect() {
    setFeedback(null);
    startTransition(async () => {
      const result = await disconnectProviderAction(connector.provider);
      setFeedback(
        result.ok
          ? { ok: true, message: "Conexão revogada e credenciais removidas." }
          : { ok: false, message: result.error },
      );
    });
  }

  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600/15 text-brand-300">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{connector.name}</p>
              <p className="text-xs text-white/40">
                {connector.shopName ?? connector.description}
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}
          >
            {status.label}
          </span>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-surface-700/60 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-white/35">Importados</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white">
              {connector.importedCount}
            </dd>
          </div>
          <div className="rounded-lg border border-surface-700/60 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-white/35">Duplicados</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white">
              {connector.duplicatedCount}
            </dd>
          </div>
          <div className="rounded-lg border border-surface-700/60 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-white/35">Falhas</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white">
              {connector.failedCount}
            </dd>
          </div>
        </dl>

        <div className="space-y-1 text-xs text-white/40">
          <p>
            Última sincronização:{" "}
            <span className="text-white/60">{formatDateTime(connector.lastSyncAt)}</span>
            {connector.syncCount > 0 && <span> · {connector.syncCount} execução(ões)</span>}
          </p>
          {connector.publicKeyPreview && (
            <p>
              Public key: <span className="font-mono text-white/60">{connector.publicKeyPreview}</span>
            </p>
          )}
          {connector.lastError && (
            <p className="line-clamp-2 text-amber-300/80">{connector.lastError}</p>
          )}
        </div>

        {canManage ? (
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
  return (
    <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {connectors.map((connector) => (
        <MarketplaceCard key={connector.provider} connector={connector} canManage={canManage} />
      ))}
    </div>
  );
}
