import { describe, expect, it, vi } from "vitest";
import type { Connector, ConnectorStatus } from "@prisma/client";
import { toConnectorCardDTO } from "@/modules/marketplace/core/connector.dto";
import { createMarketplaceService } from "@/modules/marketplace/core/connector.service";
import type { MarketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import {
  getMercadoPagoEnvironmentCredentials,
  hasPersistedMercadoPagoCredentials,
} from "@/modules/marketplace/mercadopago/credentials";

vi.mock("@/modules/marketplace/tiktok/tiktok-bridge.service", () => ({
  mirrorTikTokConnection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/modules/marketplace/instagram/instagram-bridge.service", () => ({
  mirrorInstagramConnection: vi.fn().mockResolvedValue(null),
}));

const descriptor = {
  provider: "MERCADOPAGO" as const,
  name: "Mercado Pago",
  description: "Checkout e faturamento.",
  authType: "apikeys" as const,
};

const NOW = new Date("2026-10-01T12:00:00.000Z");

function connectorRow(overrides: Partial<Connector> = {}): Connector {
  return {
    id: "connector_mp",
    organizationId: "org_a",
    provider: "MERCADOPAGO",
    status: "ERROR",
    shopId: "seller_1",
    shopName: "Brobond",
    accessToken: "encrypted-access-token",
    refreshToken: null,
    clientSecret: null,
    publicKey: "encrypted-public-key",
    expiresAt: null,
    importedCount: 9,
    duplicatedCount: 2,
    failedCount: 1,
    syncCount: 4,
    lastSyncAt: NOW,
    lastError: "Falha anterior",
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Connector;
}

function statusRow(): ConnectorStatus {
  return {
    id: "status_mp",
    organizationId: "org_a",
    platform: "MERCADOPAGO",
    state: "ACTIVE",
    enabled: true,
    importedCount: 17,
    duplicateCount: 4,
    failedCount: 1,
    syncCount: 3,
    lastSyncAt: NOW,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as ConnectorStatus;
}

describe("Mercado Pago card persistence", () => {
  it("accepts the Render fallback only when both credentials are present", () => {
    expect(
      getMercadoPagoEnvironmentCredentials({
        MERCADOPAGO_ACCESS_TOKEN: "  APP_USR-token  ",
        MERCADOPAGO_PUBLIC_KEY: "  APP_USR-public  ",
      }),
    ).toEqual({ accessToken: "APP_USR-token", publicKey: "APP_USR-public" });

    expect(
      getMercadoPagoEnvironmentCredentials({ MERCADOPAGO_ACCESS_TOKEN: "APP_USR-token" }),
    ).toBeNull();
    expect(getMercadoPagoEnvironmentCredentials({ MERCADOPAGO_PUBLIC_KEY: "public" })).toBeNull();
  });

  it("requires both encrypted fields to consider the Connector row durable", () => {
    expect(
      hasPersistedMercadoPagoCredentials({ accessToken: "encrypted-a", publicKey: "encrypted-p" }),
    ).toBe(true);
    expect(
      hasPersistedMercadoPagoCredentials({ accessToken: "encrypted-a", publicKey: null }),
    ).toBe(false);
    expect(hasPersistedMercadoPagoCredentials(null)).toBe(false);
  });

  it("initializes the live card from Render and reuses ConnectorStatus metrics", async () => {
    const service = createMarketplaceService({
      repository: {
        list: vi.fn().mockResolvedValue([]),
      } as unknown as MarketplaceRepository,
      statusRepository: { findStatus: vi.fn().mockResolvedValue(statusRow()) },
      env: {
        MERCADOPAGO_ACCESS_TOKEN: "APP_USR-secret-token",
        MERCADOPAGO_PUBLIC_KEY: "APP_USR-secret-public",
      },
    });

    const cards = await service.listConnectorCards("org_a");
    const mercadoPago = cards.find((card) => card.provider === "MERCADOPAGO");

    expect(mercadoPago).toMatchObject({
      status: "CONNECTED",
      connected: true,
      locked: true,
      credentialSource: "environment",
      importedCount: 17,
      duplicatedCount: 4,
      failedCount: 1,
      syncCount: 3,
      publicKeyPreview: "••••blic",
    });
    expect(JSON.stringify(mercadoPago)).not.toContain("APP_USR-secret");
  });

  it("makes the Render Access Token available to synchronization without exposing it in the DTO", async () => {
    const service = createMarketplaceService({
      repository: {
        findByProvider: vi.fn().mockResolvedValue(null),
      } as unknown as MarketplaceRepository,
      env: {
        MERCADOPAGO_ACCESS_TOKEN: "APP_USR-sync-token",
        MERCADOPAGO_PUBLIC_KEY: "APP_USR-sync-public",
      },
    });

    await expect(service.getValidAccessToken("org_a", "MERCADOPAGO")).resolves.toEqual({
      accessToken: "APP_USR-sync-token",
      shopId: null,
    });
  });

  it("keeps the database credential pair ahead of the Render fallback", async () => {
    const service = createMarketplaceService({
      repository: {
        list: vi.fn().mockResolvedValue([connectorRow()]),
      } as unknown as MarketplaceRepository,
      statusRepository: { findStatus: vi.fn().mockResolvedValue(null) },
      env: {
        MERCADOPAGO_ACCESS_TOKEN: "APP_USR-env-token",
        MERCADOPAGO_PUBLIC_KEY: "APP_USR-env-public",
      },
    });

    const cards = await service.listConnectorCards("org_a");
    const mercadoPago = cards.find((card) => card.provider === "MERCADOPAGO");

    expect(mercadoPago).toMatchObject({
      status: "CONNECTED",
      connected: true,
      locked: true,
      credentialSource: "database",
      importedCount: 9,
      duplicatedCount: 2,
      syncCount: 4,
    });
  });

  it("serializes an environment fallback as a locked connected card with metrics", () => {
    const dto = toConnectorCardDTO(descriptor, null, {
      status: "CONNECTED",
      locked: true,
      credentialSource: "environment",
      publicKeyPreview: "••••blic",
      metrics: {
        importedCount: 17,
        duplicatedCount: 4,
        failedCount: 1,
        syncCount: 3,
        lastSyncAt: "2026-10-01T12:00:00.000Z",
        lastError: null,
      },
    });

    expect(dto).toMatchObject({
      provider: "MERCADOPAGO",
      status: "CONNECTED",
      connected: true,
      locked: true,
      credentialSource: "environment",
      importedCount: 17,
      duplicatedCount: 4,
      failedCount: 1,
      syncCount: 3,
      publicKeyPreview: "••••blic",
    });
    expect(JSON.stringify(dto)).not.toContain("APP_USR");
  });

  it("keeps an unconfigured card disconnected and editable by default", () => {
    expect(toConnectorCardDTO(descriptor, null)).toMatchObject({
      status: "DISCONNECTED",
      connected: false,
      locked: false,
      credentialSource: null,
    });
  });
});
