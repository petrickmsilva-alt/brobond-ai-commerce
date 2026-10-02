import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connector } from "@prisma/client";

/**
 * PR016.1 — what the platform does once Mercado Livre refuses a credential.
 *
 * A failure that only re-authentication can fix must never look like a
 * transient one: the connector is parked in EXPIRED (not ERROR), the error
 * carries `requiresReauth`, and every layer up to the server action keeps
 * that flag so the card can render "Conectar Conta do Mercado Livre".
 */

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
    ensureStatus: vi.fn().mockResolvedValue({ id: "status_1" }),
    recordSyncResult: vi.fn().mockResolvedValue(null),
    findContentByExternalId: vi.fn().mockResolvedValue(null),
    createContent: vi.fn().mockResolvedValue({ id: "content_1" }),
    refreshContent: vi.fn().mockResolvedValue(null),
    findStatus: vi.fn().mockResolvedValue(null),
  },
}));

import { createMarketplaceService } from "@/modules/marketplace/core/connector.service";
import { createMarketplaceSyncService } from "@/modules/marketplace/core/sync.service";
import type { MarketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import {
  ConnectorReauthRequiredError,
  ProviderApiError,
  requiresReauthentication,
} from "@/modules/marketplace/core/errors";
import { encryptConnectorSecret } from "@/modules/marketplace/core/crypto.service";
import { MercadoLivreConnectionRequiredError } from "@/modules/connectors/mercadolivre/mercadolivre.connector";
import {
  CONNECTOR_PROVIDER_ACCOUNT_LABELS,
  connectorConnectLabel,
} from "@/modules/marketplace/core/providers";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const NOW = new Date("2026-10-02T12:00:00.000Z");

function connectorRow(overrides: Partial<Connector> = {}): Connector {
  return {
    id: "connector_ml",
    organizationId: "org_a",
    provider: "MERCADOLIVRE",
    status: "CONNECTED",
    shopId: "123456789",
    shopName: "Brobond Store",
    accessToken: encryptConnectorSecret("APP_USR-live-token", KEY_A),
    refreshToken: encryptConnectorSecret("TG-refresh-token", KEY_A),
    clientSecret: null,
    publicKey: null,
    expiresAt: new Date("2026-10-02T18:00:00.000Z"),
    importedCount: 0,
    duplicatedCount: 0,
    failedCount: 0,
    syncCount: 0,
    lastSyncAt: null,
    lastError: null,
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Connector;
}

beforeEach(() => {
  process.env.CONNECTOR_ENCRYPTION_KEY = KEY_A;
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------
// getValidAccessToken
// ------------------------------------------------------------------

describe("getValidAccessToken() — Mercado Livre credential resolution", () => {
  it("returns the decrypted token while it is still valid", async () => {
    const service = createMarketplaceService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(connectorRow()),
      } as unknown as MarketplaceRepository,
      now: () => NOW,
    });

    await expect(service.getValidAccessToken("org_a", "MERCADOLIVRE")).resolves.toEqual({
      accessToken: "APP_USR-live-token",
      shopId: "123456789",
    });
  });

  it("asks for a connection (never a retry) when no credential was ever stored", async () => {
    const service = createMarketplaceService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(connectorRow({ accessToken: null })),
      } as unknown as MarketplaceRepository,
      now: () => NOW,
    });

    const error = await service
      .getValidAccessToken("org_a", "MERCADOLIVRE")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConnectorReauthRequiredError);
    expect(requiresReauthentication(error)).toBe(true);
  });

  it("explains a CONNECTOR_ENCRYPTION_KEY rotation instead of failing opaquely", async () => {
    // Stored under key A, the deployment now runs with key B: the AES-GCM
    // auth tag no longer matches and the row still claims CONNECTED.
    process.env.CONNECTOR_ENCRYPTION_KEY = KEY_B;
    const service = createMarketplaceService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(connectorRow()),
      } as unknown as MarketplaceRepository,
      now: () => NOW,
    });

    const error = await service
      .getValidAccessToken("org_a", "MERCADOLIVRE")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConnectorReauthRequiredError);
    expect((error as Error).message).toContain("CONNECTOR_ENCRYPTION_KEY");
    expect((error as Error).message).toContain("Reconecte a conta");
    // The ciphertext must never leak into the operator-facing message.
    expect((error as Error).message).not.toContain("v1.");
  });

  it("parks the connector in EXPIRED and demands reconnection when the refresh fails", async () => {
    const setStatus = vi.fn().mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    process.env.MERCADOLIVRE_CLIENT_ID = "123";
    process.env.MERCADOLIVRE_CLIENT_SECRET = "secret";

    const service = createMarketplaceService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(
          // Already past the 5-minute refresh skew.
          connectorRow({ expiresAt: new Date("2026-10-02T12:01:00.000Z") }),
        ),
        setStatus,
        saveTokens: vi.fn(),
      } as unknown as MarketplaceRepository,
      now: () => NOW,
    });

    const error = await service
      .getValidAccessToken("org_a", "MERCADOLIVRE")
      .catch((caught: unknown) => caught);

    expect(requiresReauthentication(error)).toBe(true);
    // The raw Meli payload ("invalid_grant") never becomes the operator's
    // message — it is replaced by the action to take.
    expect((error as Error).message).not.toContain("invalid_grant");
    expect((error as Error).message).toContain("Reconecte a conta");
    expect(setStatus).toHaveBeenCalledWith(
      "org_a",
      "MERCADOLIVRE",
      "EXPIRED",
      expect.stringContaining("reconecte"),
    );
  });
});

// ------------------------------------------------------------------
// Sync service
// ------------------------------------------------------------------

describe("syncProvider() — an authorization failure is EXPIRED, not ERROR", () => {
  function syncHarness(error: unknown) {
    const recordSyncResult = vi.fn().mockResolvedValue(null);
    const syncService = createMarketplaceSyncService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(connectorRow()),
        recordSyncResult,
      } as unknown as MarketplaceRepository,
      service: {
        getValidAccessToken: vi.fn().mockRejectedValue(error),
      } as never,
    });
    return { syncService, recordSyncResult };
  }

  it("downgrades the card to EXPIRED so it offers reconnection", async () => {
    const { syncService, recordSyncResult } = syncHarness(
      new ConnectorReauthRequiredError(
        "MERCADOLIVRE",
        'A autorização do Mercado Livre expirou ou foi revogada. Clique em "Conectar Conta do Mercado Livre" para reautenticar o canal.',
      ),
    );

    await expect(syncService.syncProvider("org_a", "MERCADOLIVRE", 50)).rejects.toBeInstanceOf(
      ConnectorReauthRequiredError,
    );

    expect(recordSyncResult).toHaveBeenCalledWith(
      "org_a",
      "MERCADOLIVRE",
      expect.objectContaining({
        status: "EXPIRED",
        lastError: expect.stringContaining("Conectar Conta do Mercado Livre"),
      }),
    );
  });

  it("keeps a transient provider outage as ERROR (the credential is fine)", async () => {
    const { syncService, recordSyncResult } = syncHarness(
      new ProviderApiError("O Mercado Livre está instável no momento.", 503, "MERCADOLIVRE"),
    );

    await expect(syncService.syncProvider("org_a", "MERCADOLIVRE", 50)).rejects.toBeInstanceOf(
      ProviderApiError,
    );

    expect(recordSyncResult).toHaveBeenCalledWith(
      "org_a",
      "MERCADOLIVRE",
      expect.objectContaining({ status: "ERROR" }),
    );
  });

  it("refuses to sync a channel that was never connected", async () => {
    const recordSyncResult = vi.fn().mockResolvedValue(null);
    const syncService = createMarketplaceSyncService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(connectorRow({ accessToken: null })),
        recordSyncResult,
      } as unknown as MarketplaceRepository,
      service: { getValidAccessToken: vi.fn() } as never,
    });

    const error = await syncService
      .syncProvider("org_a", "MERCADOLIVRE", 50)
      .catch((caught: unknown) => caught);

    expect(requiresReauthentication(error)).toBe(true);
  });
});

// ------------------------------------------------------------------
// Adapter + UI copy
// ------------------------------------------------------------------

describe("connect call to action", () => {
  it("names the Mercado Livre account exactly as the panel button does", () => {
    expect(connectorConnectLabel("MERCADOLIVRE")).toBe("Conectar Conta do Mercado Livre");
    expect(connectorConnectLabel("MERCADOLIVRE", true)).toBe("Reconectar Conta do Mercado Livre");
    expect(CONNECTOR_PROVIDER_ACCOUNT_LABELS.MERCADOLIVRE).toBe("Conta do Mercado Livre");
  });

  it("carries the reauthentication flag from the framework adapter error", () => {
    const error = new MercadoLivreConnectionRequiredError();
    expect(requiresReauthentication(error)).toBe(true);
    expect(error.message).toContain("Conectar Conta do Mercado Livre");
  });

  it("ignores unrelated failures", () => {
    expect(requiresReauthentication(new Error("boom"))).toBe(false);
    expect(requiresReauthentication(null)).toBe(false);
    expect(requiresReauthentication(undefined)).toBe(false);
    expect(requiresReauthentication("expired")).toBe(false);
  });
});
