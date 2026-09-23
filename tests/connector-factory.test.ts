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
import type { Connector } from "@/modules/connectors/core/connector.interface";
import {
  ConnectorNotImplementedError,
  ConnectorNotRegisteredError,
} from "@/modules/connectors/core/connector.interface";

/**
 * PR005 — the connector factory.
 *
 * `getConnector(platform)` is the ONLY supported way to obtain a connector.
 * MOCK and the server-only TikTok Shop adapter are implemented; Instagram and
 * Shopee remain placeholders.
 */

describe("getConnector", () => {
  it("resolves MOCK to the MockConnector", () => {
    expect(getConnector(ConnectorPlatform.MOCK)).toBeInstanceOf(MockConnector);
  });

  it("resolves TIKTOK to the official TikTok Shop adapter", () => {
    expect(getConnector(ConnectorPlatform.TIKTOK)).toBeInstanceOf(TikTokConnector);
  });

  it("resolves INSTAGRAM to the Instagram placeholder", () => {
    expect(getConnector(ConnectorPlatform.INSTAGRAM)).toBeInstanceOf(InstagramConnector);
  });

  it("resolves SHOPEE to the Shopee placeholder", () => {
    expect(getConnector(ConnectorPlatform.SHOPEE)).toBeInstanceOf(ShopeeConnector);
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
  it("returns the mock connector (the only implemented one in PR005)", () => {
    expect(getDefaultConnector()).toBeInstanceOf(MockConnector);
    expect(getDefaultConnector().implemented).toBe(true);
  });

  it("is equivalent to getConnector(MOCK)", () => {
    expect(getDefaultConnector()).toBe(getConnector(ConnectorPlatform.MOCK));
  });
});

describe("registry helpers", () => {
  it("lists every platform in declaration order (MOCK first)", () => {
    expect(listConnectorPlatforms()).toEqual(["MOCK", "TIKTOK", "INSTAGRAM", "SHOPEE"]);
  });

  it("getAllConnectors returns one adapter per registered platform", () => {
    const connectors = getAllConnectors();
    expect(connectors).toHaveLength(Object.values(ConnectorPlatform).length);
    expect(connectors.map((connector) => connector.platform)).toEqual(listConnectorPlatforms());
  });

  it("getImplementedConnectors includes MOCK and real TikTok Shop", () => {
    const implemented = getImplementedConnectors();
    expect(implemented).toHaveLength(2);
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

describe("placeholder adapters (Instagram · Shopee)", () => {
  const placeholders = [ConnectorPlatform.INSTAGRAM, ConnectorPlatform.SHOPEE];

  it("declares placeholders as not implemented", () => {
    for (const platform of placeholders) {
      expect(getConnector(platform).implemented).toBe(false);
    }
  });

  it("throw ConnectorNotImplementedError on fetchContent()", async () => {
    for (const platform of placeholders) {
      await expect(getConnector(platform).fetchContent()).rejects.toBeInstanceOf(
        ConnectorNotImplementedError,
      );
    }
  });

  it("carry the offending platform on the thrown error", async () => {
    for (const platform of placeholders) {
      await expect(getConnector(platform).fetchContent()).rejects.toMatchObject({ platform });
    }
  });

  it("testConnection() never throws — it reports 'não implementado'", async () => {
    for (const platform of placeholders) {
      const health = await getConnector(platform).testConnection();
      expect(health).toMatchObject({ platform, ok: false, implemented: false });
      expect(health.message).toMatch(/placeholder/i);
    }
  });
});
