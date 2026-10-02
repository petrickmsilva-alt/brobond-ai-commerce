import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connector, ConnectorEvent } from "@prisma/client";

/**
 * PR016.2 — the Mercado Pago token "crypto catch".
 *
 * THE PRODUCTION BUG
 * ------------------
 * The Mercado Pago Access Token was persisted (AES-256-GCM) BEFORE a
 * `CONNECTOR_ENCRYPTION_KEY` rotation. Every later read tried to open the
 * old ciphertext, the AES-GCM auth tag never matched again, and the raw
 * crypto failure escaped as an opaque error — while the row still claimed
 * CONNECTED and the locked card kept offering "Sincronizar agora".
 *
 * THE CONTRACT PINNED HERE
 * ------------------------
 *   1. `getValidAccessToken()` wraps the read+decrypt path in a robust
 *      try/catch: an undecryptable token becomes a graceful, actionable
 *      `ConnectorTokenUndecryptableError` — never a crash, and never the
 *      Render environment pair as a silent fallback;
 *   2. the channel is parked in the dedicated `REAUTH_REQUIRED` status on
 *      PostgreSQL (best-effort: a DB failure must not become a second
 *      crash);
 *   3. the panel unlocks the card and renders the clean connect button;
 *   4. the sync service records REAUTH_REQUIRED (not EXPIRED/ERROR);
 *   5. the financial-flow worker defers the delivery gracefully — the
 *      event stays pending in the inbox and is retried after the operator
 *      reconnects, so the server never crashes.
 */

vi.mock("@/lib/observability/logger", () => ({ log: vi.fn() }));
vi.mock("@/lib/async/queue", () => ({
  SALE_INGESTION_QUEUE: "sale-ingestion",
  enqueueSaleIngestion: vi.fn(async () => undefined),
}));

vi.mock("@/modules/marketplace/tiktok/tiktok-bridge.service", () => ({
  mirrorTikTokConnection: vi.fn().mockResolvedValue(null),
  fetchTikTokContent: vi.fn(),
}));
vi.mock("@/modules/marketplace/instagram/instagram-bridge.service", () => ({
  mirrorInstagramConnection: vi.fn().mockResolvedValue(null),
  fetchInstagramContent: vi.fn(),
}));

vi.mock("@/modules/connectors/core/connector.repository", () => ({
  connectorRepository: {
    ensureStatus: vi.fn().mockResolvedValue({ id: "status_mp" }),
    recordSyncResult: vi.fn().mockResolvedValue(null),
    recordIngestionCounters: vi.fn().mockResolvedValue(null),
    findStatus: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/modules/marketplace/core/connector.repository", () => ({
  marketplaceRepository: {
    findEvent: vi.fn(),
    markEventProcessed: vi.fn(),
  },
}));

vi.mock("@/modules/sales/sales.service", () => ({ salesService: {} }));
vi.mock("@/modules/analytics/services/analytics.service", () => ({ analyticsService: {} }));

// The real factory stays available (importOriginal); only the SINGLETON the
// ingestion worker consumes is replaced, so the deferred-reauth path can be
// driven per test.
vi.mock("@/modules/marketplace/core/connector.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/marketplace/core/connector.service")>();
  return { ...actual, marketplaceService: { getValidAccessToken: vi.fn() } };
});

import { createMarketplaceService } from "@/modules/marketplace/core/connector.service";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import { createMarketplaceSyncService } from "@/modules/marketplace/core/sync.service";
import { processSaleIngestionEvent } from "@/modules/marketplace/ingestion/sale-ingestion.service";
import type { MarketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import { marketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import {
  ConnectorTokenUndecryptableError,
  ProviderApiError,
  requiresReauthentication,
} from "@/modules/marketplace/core/errors";
import { encryptConnectorSecret } from "@/modules/marketplace/core/crypto.service";

const KEY_OLD = "a".repeat(64); // the key the token was encrypted with
const KEY_NEW = "b".repeat(64); // the key the deployment now runs with
const NOW = new Date("2026-10-02T12:00:00.000Z");
const ENV_FALLBACK = {
  MERCADOPAGO_ACCESS_TOKEN: "APP_USR-environment-token",
  MERCADOPAGO_PUBLIC_KEY: "APP_USR-environment-public",
};

function mercadoPagoRow(overrides: Partial<Connector> = {}): Connector {
  return {
    id: "connector_mp",
    organizationId: "org_a",
    provider: "MERCADOPAGO",
    status: "CONNECTED",
    shopId: "seller_1",
    shopName: "Brobond",
    // Saved BEFORE the key rotation — these ciphertexts can never open again.
    accessToken: encryptConnectorSecret("APP_USR-mp-old-token", KEY_OLD),
    refreshToken: null,
    clientSecret: null,
    publicKey: encryptConnectorSecret("APP_USR-mp-old-public", KEY_OLD),
    expiresAt: null,
    importedCount: 3,
    duplicatedCount: 0,
    failedCount: 0,
    syncCount: 2,
    lastSyncAt: NOW,
    lastError: null,
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Connector;
}

beforeEach(() => {
  process.env.CONNECTOR_ENCRYPTION_KEY = KEY_NEW;
  vi.clearAllMocks();
});

// ------------------------------------------------------------------
// 1. getValidAccessToken() — the robust crypto catch
// ------------------------------------------------------------------

describe("getValidAccessToken() — Mercado Pago token saved before the key rotation", () => {
  it("captures the failure gracefully and parks the channel in REAUTH_REQUIRED", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setStatus = vi.fn().mockResolvedValue(null);
    const service = createMarketplaceService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(mercadoPagoRow()),
        setStatus,
      } as unknown as MarketplaceRepository,
      env: ENV_FALLBACK,
      now: () => NOW,
    });

    const error = await service
      .getValidAccessToken("org_a", "MERCADOPAGO")
      .catch((caught: unknown) => caught);

    // Graceful, actionable domain error — never a raw crypto failure.
    expect(error).toBeInstanceOf(ConnectorTokenUndecryptableError);
    expect(requiresReauthentication(error)).toBe(true);
    expect((error as Error).message).toContain("CONNECTOR_ENCRYPTION_KEY");
    expect((error as Error).message).toContain("Reconecte a conta");
    // The ciphertext never leaks into the operator-facing message.
    expect((error as Error).message).not.toContain("v1.");
    // The channel is parked in the dedicated status on PostgreSQL.
    expect(setStatus).toHaveBeenCalledWith(
      "org_a",
      "MERCADOPAGO",
      "REAUTH_REQUIRED",
      expect.stringContaining("Reconecte a conta"),
    );
  });

  it("does NOT fall back to the Render environment pair when the stored pair is present", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = createMarketplaceService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(mercadoPagoRow()),
        setStatus: vi.fn().mockResolvedValue(null),
      } as unknown as MarketplaceRepository,
      env: ENV_FALLBACK,
      now: () => NOW,
    });

    const error = await service
      .getValidAccessToken("org_a", "MERCADOPAGO")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConnectorTokenUndecryptableError);
  });

  it("never crashes when even the REAUTH_REQUIRED write fails (best-effort)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = createMarketplaceService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(mercadoPagoRow()),
        setStatus: vi.fn().mockRejectedValue(new Error("db unavailable")),
      } as unknown as MarketplaceRepository,
      env: ENV_FALLBACK,
      now: () => NOW,
    });

    const error = await service
      .getValidAccessToken("org_a", "MERCADOPAGO")
      .catch((caught: unknown) => caught);

    // The domain error survives; the DB failure is logged, never rethrown.
    expect(error).toBeInstanceOf(ConnectorTokenUndecryptableError);
  });

  it("still returns a healthy token encrypted with the CURRENT key", async () => {
    const healthy = mercadoPagoRow({
      accessToken: encryptConnectorSecret("APP_USR-mp-live-token", KEY_NEW),
      publicKey: encryptConnectorSecret("APP_USR-mp-live-public", KEY_NEW),
    });
    const service = createMarketplaceService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(healthy),
      } as unknown as MarketplaceRepository,
      env: ENV_FALLBACK,
      now: () => NOW,
    });

    await expect(service.getValidAccessToken("org_a", "MERCADOPAGO")).resolves.toEqual({
      accessToken: "APP_USR-mp-live-token",
      shopId: "seller_1",
    });
  });
});

// ------------------------------------------------------------------
// 2. listConnectorCards() — the clean connect button
// ------------------------------------------------------------------

describe("listConnectorCards() — a REAUTH_REQUIRED channel unlocks the card", () => {
  function cardsHarness(rows: Connector[], env: Record<string, string | undefined> = {}) {
    const service = createMarketplaceService({
      repository: { list: vi.fn().mockResolvedValue(rows) } as unknown as MarketplaceRepository,
      env,
    });
    return service.listConnectorCards("org_a");
  }

  it("renders the clean connect state instead of the locked connected card", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cards = await cardsHarness([mercadoPagoRow({ status: "REAUTH_REQUIRED" })], ENV_FALLBACK);

    const mercadoPagoCard = cards.find((card) => card.provider === "MERCADOPAGO");
    expect(mercadoPagoCard).toMatchObject({
      status: "REAUTH_REQUIRED",
      connected: false,
      locked: false,
      credentialSource: null,
    });
  });

  it("keeps a decryptable credential locked and connected (regression guard)", async () => {
    const cards = await cardsHarness([
      mercadoPagoRow({
        accessToken: encryptConnectorSecret("APP_USR-mp-live-token", KEY_NEW),
        publicKey: encryptConnectorSecret("APP_USR-mp-live-public", KEY_NEW),
      }),
    ]);

    const mercadoPagoCard = cards.find((card) => card.provider === "MERCADOPAGO");
    expect(mercadoPagoCard).toMatchObject({
      status: "CONNECTED",
      connected: true,
      locked: true,
      credentialSource: "database",
    });
  });
});

// ------------------------------------------------------------------
// 3. syncProvider() — REAUTH_REQUIRED, not EXPIRED/ERROR
// ------------------------------------------------------------------

describe("syncProvider() — an undecryptable credential is REAUTH_REQUIRED", () => {
  it("records the dedicated status so the card offers reconnection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recordSyncResult = vi.fn().mockResolvedValue(null);
    const syncService = createMarketplaceSyncService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(mercadoPagoRow()),
        recordSyncResult,
      } as unknown as MarketplaceRepository,
      service: {
        getValidAccessToken: vi
          .fn()
          .mockRejectedValue(
            new ConnectorTokenUndecryptableError(
              "MERCADOPAGO",
              "Não foi possível descriptografar o token de acesso salvo deste conector — a chave CONNECTOR_ENCRYPTION_KEY mudou desde a conexão. Reconecte a conta para gerar credenciais novas.",
            ),
          ),
      } as never,
      env: {},
    });

    await expect(syncService.syncProvider("org_a", "MERCADOPAGO", 50)).rejects.toBeInstanceOf(
      ConnectorTokenUndecryptableError,
    );

    expect(recordSyncResult).toHaveBeenCalledWith(
      "org_a",
      "MERCADOPAGO",
      expect.objectContaining({ status: "REAUTH_REQUIRED" }),
    );
  });
});

// ------------------------------------------------------------------
// 4. Financial-flow worker — graceful deferral, never a crash
// ------------------------------------------------------------------

describe("processSaleIngestionEvent() — the crypto catch on the financial flow", () => {
  const pendingPaymentEvent = {
    id: "evt_mp_1",
    organizationId: "org_a",
    provider: "MERCADOPAGO",
    externalEventId: "mp:123",
    connectorId: "connector_mp",
    topic: "payment",
    payload: { data: { id: 123 } },
    processedAt: null,
    createdAt: NOW,
  } as unknown as ConnectorEvent;

  function undecryptableTokenError() {
    return new ConnectorTokenUndecryptableError(
      "MERCADOPAGO",
      "Não foi possível descriptografar o token de acesso salvo deste conector — a chave CONNECTOR_ENCRYPTION_KEY mudou desde a conexão. Reconecte a conta para gerar credenciais novas.",
    );
  }

  it("defers the delivery gracefully and keeps it pending for the post-reconnect retry", async () => {
    vi.mocked(marketplaceRepository.findEvent).mockResolvedValue(pendingPaymentEvent);
    vi.mocked(marketplaceService.getValidAccessToken).mockRejectedValue(undecryptableTokenError());

    const result = await processSaleIngestionEvent({
      organizationId: "org_a",
      provider: "MERCADOPAGO",
      externalEventId: "mp:123",
    });

    // No crash, no exception: the job completes with a terminal-for-now
    // result and the inbox row stays unprocessed, so the pending-event
    // scanner retries it once the account is reconnected.
    expect(result).toMatchObject({
      provider: "MERCADOPAGO",
      externalEventId: "mp:123",
      status: "skipped",
    });
    expect(marketplaceRepository.markEventProcessed).not.toHaveBeenCalled();
  });

  it("still throws for TRANSIENT failures so BullMQ retries with backoff", async () => {
    vi.mocked(marketplaceRepository.findEvent).mockResolvedValue(pendingPaymentEvent);
    vi.mocked(marketplaceService.getValidAccessToken).mockRejectedValue(
      new ProviderApiError("Falha de rede ao contatar o Mercado Pago.", 503, "MERCADOPAGO"),
    );

    await expect(
      processSaleIngestionEvent({
        organizationId: "org_a",
        provider: "MERCADOPAGO",
        externalEventId: "mp:123",
      }),
    ).rejects.toBeInstanceOf(ProviderApiError);
  });
});
