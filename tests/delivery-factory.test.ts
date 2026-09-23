import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertAllDeliveryChannelsRegistered,
  getAllDeliveryConnectors,
  getDeliveryConnector,
  isDeliveryConnectorRegistered,
  listDeliveryConnectorChannels,
  resetDeliveryConnectorCache,
} from "@/modules/delivery/core/delivery.factory";
import {
  DELIVERY_CHANNELS,
  DeliveryConnectorNotRegisteredError,
} from "@/modules/delivery/core/delivery.interface";
import { InstagramConnector } from "@/modules/delivery/instagram/dm.service";
import { WhatsAppConnector } from "@/modules/delivery/whatsapp/message.service";

describe("Delivery factory (Map-based)", () => {
  beforeEach(() => resetDeliveryConnectorCache());

  it("resolves INSTAGRAM to the InstagramConnector", () => {
    const connector = getDeliveryConnector("INSTAGRAM");
    expect(connector).toBeInstanceOf(InstagramConnector);
    expect(connector.channel).toBe("INSTAGRAM");
  });

  it("resolves WHATSAPP to the WhatsAppConnector", () => {
    const connector = getDeliveryConnector("WHATSAPP");
    expect(connector).toBeInstanceOf(WhatsAppConnector);
    expect(connector.channel).toBe("WHATSAPP");
  });

  it("returns a stable lazy singleton per channel", () => {
    expect(getDeliveryConnector("INSTAGRAM")).toBe(getDeliveryConnector("INSTAGRAM"));
    expect(getDeliveryConnector("WHATSAPP")).toBe(getDeliveryConnector("WHATSAPP"));
    expect(getDeliveryConnector("INSTAGRAM")).not.toBe(getDeliveryConnector("WHATSAPP"));
  });

  it("resetDeliveryConnectorCache forces a rebuild", () => {
    const first = getDeliveryConnector("INSTAGRAM");
    resetDeliveryConnectorCache();
    const second = getDeliveryConnector("INSTAGRAM");
    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(InstagramConnector);
  });

  it("lists exactly the contracted channels in declaration order", () => {
    expect(listDeliveryConnectorChannels()).toEqual(["INSTAGRAM", "WHATSAPP"]);
  });

  it("getAllDeliveryConnectors mirrors the channel order", () => {
    const all = getAllDeliveryConnectors();
    expect(all).toHaveLength(2);
    expect(all.map((connector) => connector.channel)).toEqual(["INSTAGRAM", "WHATSAPP"]);
  });

  it("every connector exposes the DeliveryConnector contract", () => {
    for (const connector of getAllDeliveryConnectors()) {
      expect(typeof connector.sendMessage).toBe("function");
      expect(DELIVERY_CHANNELS).toContain(connector.channel);
    }
  });

  it("registers every declared channel", () => {
    for (const channel of DELIVERY_CHANNELS) {
      expect(isDeliveryConnectorRegistered(channel)).toBe(true);
    }
    expect(() => assertAllDeliveryChannelsRegistered()).not.toThrow();
  });

  it("rejects unregistered channels", () => {
    expect(isDeliveryConnectorRegistered("TIKTOK" as never)).toBe(false);
    expect(() => getDeliveryConnector("TIKTOK" as never)).toThrow(
      DeliveryConnectorNotRegisteredError,
    );
    expect(() => getDeliveryConnector("" as never)).toThrow(/No delivery connector registered/);
    expect(() => getDeliveryConnector("TELEGRAM" as never)).toThrow(/"TELEGRAM"/);
  });

  it("is the ONLY channel mapping site — no switch outside the factory", () => {
    const factorySource = readFileSync(
      join(__dirname, "../modules/delivery/core/delivery.factory.ts"),
      "utf8",
    );
    const dispatcherSource = readFileSync(
      join(__dirname, "../modules/delivery/queue/dispatcher.ts"),
      "utf8",
    );
    // The factory resolves through a Map; the dispatcher (and every other
    // caller) must delegate to it instead of branching on channels.
    expect(factorySource).toContain("new Map<DeliveryChannelName");
    expect(dispatcherSource).not.toMatch(/switch\s*\(/);
    expect(dispatcherSource).toContain("getDeliveryConnector");
  });

  it("no production module outside the factory switches on channels", () => {
    const source =
      readFileSync(join(__dirname, "../modules/delivery/queue/dispatcher.ts"), "utf8") +
      readFileSync(join(__dirname, "../modules/delivery/instagram/dm.service.ts"), "utf8");
    expect(source).not.toMatch(/switch\s*\(/);
  });
});

describe("DeliveryConnectorNotRegisteredError", () => {
  it("carries the offending channel in the message", () => {
    const error = new DeliveryConnectorNotRegisteredError("MYSPACE");
    expect(error.name).toBe("DeliveryConnectorNotRegisteredError");
    expect(error.message).toContain("MYSPACE");
    expect(error).toBeInstanceOf(Error);
  });
});
