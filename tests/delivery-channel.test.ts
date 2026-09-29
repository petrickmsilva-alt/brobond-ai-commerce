import { describe, expect, it } from "vitest";
import { DeliveryChannel, DeliveryStatus, DeliveryAccountStatus } from "@prisma/client";
import {
  COMMERCE_EXECUTION_APPROVED,
  DELIVERY_CHANNELS,
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  TERMINAL_DELIVERY_STATUSES,
  isDeliveryChannel,
  isDeliveryStatus,
} from "@/modules/delivery/core/delivery.interface";

/**
 * Pins the client-safe mirrors of the Prisma enums: adding a channel or
 * status in the schema WITHOUT updating the delivery module fails here.
 */
describe("Delivery enum mirrors", () => {
  it("DELIVERY_CHANNELS mirrors the Prisma DeliveryChannel enum exactly", () => {
    expect([...DELIVERY_CHANNELS].sort()).toEqual(Object.values(DeliveryChannel).sort());
  });

  it("DELIVERY_STATUSES mirrors the Prisma DeliveryStatus enum exactly", () => {
    expect([...DELIVERY_STATUSES].sort()).toEqual(Object.values(DeliveryStatus).sort());
  });

  it("both contracted channels exist", () => {
    expect(DELIVERY_CHANNELS).toContain("INSTAGRAM");
    expect(DELIVERY_CHANNELS).toContain("WHATSAPP");
  });

  it("the contracted lifecycle statuses exist in order", () => {
    expect(DELIVERY_STATUSES.slice(0, 6)).toEqual([
      "DRAFT",
      "QUEUED",
      "SENDING",
      "SENT",
      "DELIVERED",
      "READ",
    ]);
    expect(DELIVERY_STATUSES).toContain("FAILED");
    expect(DELIVERY_STATUSES).toContain("CANCELLED");
  });

  it("every channel has a Portuguese label", () => {
    for (const channel of DELIVERY_CHANNELS) {
      expect(DELIVERY_CHANNEL_LABELS[channel]).toBeTruthy();
    }
  });

  it("every status has a Portuguese label", () => {
    for (const status of DELIVERY_STATUSES) {
      expect(DELIVERY_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("channel labels mention the official products", () => {
    expect(DELIVERY_CHANNEL_LABELS.INSTAGRAM).toContain("Instagram");
    expect(DELIVERY_CHANNEL_LABELS.WHATSAPP).toContain("WhatsApp");
  });

  it("account statuses mirror the TikTok lifecycle contract", () => {
    expect(Object.values(DeliveryAccountStatus).sort()).toEqual(
      ["CONNECTED", "DISCONNECTED", "ERROR", "EXPIRED"].sort(),
    );
  });

  it("isDeliveryChannel narrows exactly the registered channels", () => {
    expect(isDeliveryChannel("INSTAGRAM")).toBe(true);
    expect(isDeliveryChannel("WHATSAPP")).toBe(true);
    expect(isDeliveryChannel("TIKTOK")).toBe(false);
    expect(isDeliveryChannel("instagram")).toBe(false);
    expect(isDeliveryChannel("")).toBe(false);
    expect(isDeliveryChannel(undefined)).toBe(false);
    expect(isDeliveryChannel(null)).toBe(false);
    expect(isDeliveryChannel(42)).toBe(false);
  });

  it("isDeliveryStatus narrows exactly the lifecycle statuses", () => {
    for (const status of DELIVERY_STATUSES) expect(isDeliveryStatus(status)).toBe(true);
    expect(isDeliveryStatus("queued")).toBe(false);
    expect(isDeliveryStatus("PENDING")).toBe(false);
    expect(isDeliveryStatus("")).toBe(false);
    expect(isDeliveryStatus(undefined)).toBe(false);
    expect(isDeliveryStatus({})).toBe(false);
  });

  it("terminal statuses are exactly READ and CANCELLED", () => {
    expect([...TERMINAL_DELIVERY_STATUSES].sort()).toEqual(["CANCELLED", "READ"]);
    expect(TERMINAL_DELIVERY_STATUSES).not.toContain("FAILED");
  });

  it("exposes the APPROVED gate constant for executions", () => {
    expect(COMMERCE_EXECUTION_APPROVED).toBe("APPROVED");
  });
});
