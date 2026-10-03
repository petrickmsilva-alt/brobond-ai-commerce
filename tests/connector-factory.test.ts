import { describe, expect, it } from "vitest";
import { ConnectorPlatform } from "@prisma/client";
import {
  getAllConnectors,
  getConnector,
  getDefaultConnector,
  getImplementedConnectors,
  isConnectorRegistered,
  listConnectorPlatforms,
} from "@/modules/connectors/core/connector.factory";
import { MockConnector } from "@/modules/connectors/mock/mock.connector";
import { TikTokConnector } from "@/modules/connectors/tiktok/tiktok.connector";
import { InstagramConnector } from "@/modules/connectors/instagram/instagram.connector";
import { ShopeeConnector } from "@/modules/connectors/shopee/shopee.connector";
import { MercadoLivreConnector } from "@/modules/connectors/mercadolivre/mercadolivre.connector";
import { MercadoPagoConnector } from "@/modules/connectors/mercadopago/mercadopago.connector";
import { NuvemshopConnector } from "@/modules/connectors/nuvemshop/nuvemshop.connector";
import type { Connector } from "@/modules/connectors/core/connector.interface";
import { ConnectorNotRegisteredError } from "@/modules/connectors/core/connector.interface";

/**
 * PR005/PR012 — the connector factory.
 *
 * `getConnector(platform)` is the ONLY supported way to obtain a connector.
 * MOCK is the deterministic local dataset; TikTok Shop, Instagram Shopping,
 * Shopee, Mercado Livre, Mercado Pago and Nuvemshop are real,
 * server-only official API adapters (PR012). No placeholders remain.
 */

describe("getConnector", () => {
  it("resolves MOCK to the MockConnector", () => {
    expect(getConnector(ConnectorPlatform.MOCK)).toBeInstanceOf(MockConnector);
  });

  it("resolves TIKTOK to the official TikTok Shop adapter", () => {
    expect(getConnector(ConnectorPlatform.TIKTOK)).toBeInstanceOf(TikTokConnector);
  });

  it("resolves INSTAGRAM to the real Instagram Shopping adapter", () => {
    expect(getConnector(ConnectorPlatform.INSTAGRAM)).toBeInstanceOf(InstagramConnector);
  });

  it("resolves SHOPEE to the real Shopee Open Platform adapter", () => {
    expect(getConnector(ConnectorPlatform.SHOPEE)).toBeInstanceOf(ShopeeConnector);
  });

  it("resolves MERCADOLIVRE to the real Meli API adapter", () => {
    expect(getConnector(ConnectorPlatform.MERCADOLIVRE)).toBeInstanceOf(MercadoLivreConnector);
  });

  it("resolves MERCADOPAGO to the real Mercado Pago adapter", () => {
    expect(getConnector(ConnectorPlatform.MERCADOPAGO)).toBeInstanceOf(MercadoPagoConnector);
  });

  it("resolves NUVEMSHOP to the real Nuvemshop adapter", () => {
    expect(getConnector(ConnectorPlatform.NUVEMSHOP)).toBeInstanceOf(NuvemshopConnector);
  });

  it("every resolved connector declares its own platform", () => {
    for (const platform of Object.values(ConnectorPlatform)) {
      expect(getConnector(platform).platform).toBe(platform);
    }
  });

  it("is a lazy singleton per platform (stable instances)", () => {
    expect(getConnector(ConnectorPlatform.MOCK)).toBe(getConnector(ConnectorPlatform.MOCK));
    expect(getConnector(ConnectorPlatform.TIKTOK)).toBe(getConnector(ConnectorPlatform.TIKTOK));
    expect(getConnector(ConnectorPlatform.MOCK)).not.toBe(getConnector(ConnectorPlatform.TIKTOK));
  });

  it("throws a typed error for an unregistered platform", () => {
    expect(() => getConnector("YOUTUBE" as ConnectorPlatform)).toThrowError(
      ConnectorNotRegisteredError,
    );
    expect(() => getConnector("YOUTUBE" as ConnectorPlatform)).toThrowError(
      /No Connector is registered/,
    );
  });

  it("satisfies the Connector contract for every registered platform", () => {
    const connectors: Connector[] = Object.values(ConnectorPlatform).map(getConnector);
    for (const connector of connectors) {
      expect(typeof connector.fetchContent).toBe("function");
      expect(typeof connector.testConnection).toBe("function");
      expect(typeof connector.name).toBe("string");
      expect(typeof connector.implemented).toBe("boolean");
      expect(Object.values(ConnectorPlatform)).toContain(connector.platform);
    }
  });
});

describe("getDefaultConnector", () => {
  it("returns the mock connector (the deterministic local dataset)", () => {
    expect(getDefaultConnector()).toBeInstanceOf(MockConnector);
    expect(getDefaultConnector().implemented).toBe(true);
  });

  it("is equivalent to getConnector(MOCK)", () => {
    expect(getDefaultConnector()).toBe(getConnector(ConnectorPlatform.MOCK));
  });
});

describe("registry helpers", () => {
  it("lists every platform in declaration order (MOCK first)", () => {
    expect(listConnectorPlatforms()).toEqual([
      "MOCK",
      "TIKTOK",
      "INSTAGRAM",
      "SHOPEE",
      "MERCADOLIVRE",
      "MERCADOPAGO",
      "NUVEMSHOP",
    ]);
  });

  it("getAllConnectors returns one adapter per registered platform", () => {
    const connectors = getAllConnectors();
    expect(connectors).toHaveLength(Object.values(ConnectorPlatform).length);
    expect(connectors.map((connector) => connector.platform)).toEqual(listConnectorPlatforms());
  });

  it("getImplementedConnectors covers every registered platform (PR012)", () => {
    const implemented = getImplementedConnectors();
    expect(implemented).toHaveLength(Object.values(ConnectorPlatform).length);
    expect(implemented[0]).toBeInstanceOf(MockConnector);
    expect(implemented[1]).toBeInstanceOf(TikTokConnector);
  });

  it("isConnectorRegistered is true for every known platform, false otherwise", () => {
    for (const platform of Object.values(ConnectorPlatform)) {
      expect(isConnectorRegistered(platform)).toBe(true);
    }
    expect(isConnectorRegistered("YOUTUBE" as ConnectorPlatform)).toBe(false);
  });
});

describe("TikTok Shop adapter", () => {
  it("is implemented and requires a server-injected tenant scope", async () => {
    const connector = getConnector(ConnectorPlatform.TIKTOK);
    expect(connector.implemented).toBe(true);
    await expect(connector.fetchContent()).rejects.toMatchObject({
      name: "TikTokConnectionRequiredError",
    });
  });
});

describe("real marketplace adapters (PR012)", () => {
  const realAdapters: Array<{ platform: ConnectorPlatform; errorName: string }> = [
    { platform: ConnectorPlatform.INSTAGRAM, errorName: "InstagramConnectionRequiredError" },
    { platform: ConnectorPlatform.SHOPEE, errorName: "ShopeeConnectionRequiredError" },
    { platform: ConnectorPlatform.MERCADOLIVRE, errorName: "MercadoLivreConnectionRequiredError" },
    { platform: ConnectorPlatform.MERCADOPAGO, errorName: "MercadoPagoConnectionRequiredError" },
    { platform: ConnectorPlatform.NUVEMSHOP, errorName: "NuvemshopConnectionRequiredError" },
  ];

  it("declares every marketplace adapter as implemented", () => {
    for (const { platform } of realAdapters) {
      expect(getConnector(platform).implemented).toBe(true);
    }
  });

  it("require a server-injected tenant scope on fetchContent()", async () => {
    for (const { platform, errorName } of realAdapters) {
      await expect(getConnector(platform).fetchContent()).rejects.toMatchObject({
        name: errorName,
      });
    }
  });

  it("testConnection() never throws and always reports a real adapter", async () => {
    for (const { platform } of realAdapters) {
      const health = await getConnector(platform).testConnection();
      expect(health.platform).toBe(platform);
      expect(health.implemented).toBe(true);
      expect(typeof health.ok).toBe("boolean");
      expect(health.message.length).toBeGreaterThan(0);
    }
  });
});
