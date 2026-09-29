import { describe, expect, it } from "vitest";
import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_RANK,
  DELIVERY_TRANSITIONS,
  DeliveryStateError,
  assertDeliveryTransition,
  canTransitionDeliveryStatus,
  isForwardProgress,
  type DeliveryStatusName,
} from "@/modules/delivery/core/delivery.interface";

const ALL = DELIVERY_STATUSES as readonly DeliveryStatusName[];

describe("Delivery status transition map", () => {
  it("every declared transition target is a known status", () => {
    for (const from of ALL) {
      for (const to of DELIVERY_TRANSITIONS[from]) {
        expect(ALL).toContain(to);
      }
    }
  });

  it("every status declares its transitions (no missing key)", () => {
    for (const status of ALL) {
      expect(DELIVERY_TRANSITIONS[status]).toBeDefined();
      expect(Array.isArray(DELIVERY_TRANSITIONS[status])).toBe(true);
    }
  });

  it("contracted happy path is legal end to end", () => {
    const path: DeliveryStatusName[] = ["DRAFT", "QUEUED", "SENDING", "SENT", "DELIVERED", "READ"];
    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransitionDeliveryStatus(path[index]!, path[index + 1]!)).toBe(true);
    }
  });

  it("canTransitionDeliveryStatus agrees with assertDeliveryTransition", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const allowed = canTransitionDeliveryStatus(from, to);
        if (allowed) {
          expect(() => assertDeliveryTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertDeliveryTransition(from, to)).toThrow(DeliveryStateError);
        }
      }
    }
  });

  it("READ is terminal: no outbound transitions", () => {
    expect(DELIVERY_TRANSITIONS.READ).toHaveLength(0);
    for (const to of ALL) expect(canTransitionDeliveryStatus("READ", to)).toBe(false);
  });

  it("CANCELLED may only return to QUEUED (reprocess)", () => {
    expect(DELIVERY_TRANSITIONS.CANCELLED).toEqual(["QUEUED"]);
  });

  it("FAILED may only return to QUEUED (reprocess)", () => {
    expect(DELIVERY_TRANSITIONS.FAILED).toEqual(["QUEUED"]);
    expect(canTransitionDeliveryStatus("FAILED", "SENT")).toBe(false);
    expect(canTransitionDeliveryStatus("FAILED", "DELIVERED")).toBe(false);
    expect(canTransitionDeliveryStatus("FAILED", "READ")).toBe(false);
  });

  it("SENDING may resolve to SENT, FAILED, CANCELLED or requeue", () => {
    expect(canTransitionDeliveryStatus("SENDING", "SENT")).toBe(true);
    expect(canTransitionDeliveryStatus("SENDING", "FAILED")).toBe(true);
    expect(canTransitionDeliveryStatus("SENDING", "CANCELLED")).toBe(true);
    expect(canTransitionDeliveryStatus("SENDING", "QUEUED")).toBe(true);
    expect(canTransitionDeliveryStatus("SENDING", "DRAFT")).toBe(false);
    expect(canTransitionDeliveryStatus("SENDING", "READ")).toBe(false);
  });

  it("SENT may advance to DELIVERED or READ and regress to FAILED, never backwards", () => {
    expect(canTransitionDeliveryStatus("SENT", "DELIVERED")).toBe(true);
    expect(canTransitionDeliveryStatus("SENT", "READ")).toBe(true);
    expect(canTransitionDeliveryStatus("SENT", "FAILED")).toBe(true);
    expect(canTransitionDeliveryStatus("SENT", "QUEUED")).toBe(false);
    expect(canTransitionDeliveryStatus("SENT", "SENDING")).toBe(false);
    expect(canTransitionDeliveryStatus("SENT", "DRAFT")).toBe(false);
  });

  it("DELIVERED may only advance to READ", () => {
    expect(canTransitionDeliveryStatus("DELIVERED", "READ")).toBe(true);
    expect(canTransitionDeliveryStatus("DELIVERED", "SENT")).toBe(false);
    expect(canTransitionDeliveryStatus("DELIVERED", "FAILED")).toBe(false);
    expect(canTransitionDeliveryStatus("DELIVERED", "QUEUED")).toBe(false);
  });

  it("DRAFT may only enter the queue or be cancelled", () => {
    expect(canTransitionDeliveryStatus("DRAFT", "QUEUED")).toBe(true);
    expect(canTransitionDeliveryStatus("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransitionDeliveryStatus("DRAFT", "SENDING")).toBe(false);
    expect(canTransitionDeliveryStatus("DRAFT", "SENT")).toBe(false);
  });

  it("QUEUED supports the retry re-queue self-loop", () => {
    expect(canTransitionDeliveryStatus("QUEUED", "QUEUED")).toBe(true);
    expect(canTransitionDeliveryStatus("QUEUED", "SENDING")).toBe(true);
  });

  it("assertDeliveryTransition message names the illegal edge", () => {
    expect(() => assertDeliveryTransition("READ", "QUEUED")).toThrow(/READ → QUEUED/);
  });

  it("rejects every non-adjacent happy-path shortcut", () => {
    const path: DeliveryStatusName[] = ["DRAFT", "QUEUED", "SENDING", "SENT", "DELIVERED", "READ"];
    // Legal non-adjacent edges among the happy-path statuses, on top of the
    // adjacent flow: the retry re-queue loop and the express read receipt.
    const legalExtras: ReadonlyArray<readonly [DeliveryStatusName, DeliveryStatusName]> = [
      ["QUEUED", "QUEUED"],
      ["SENDING", "QUEUED"],
      ["SENT", "READ"],
    ];
    for (const from of path) {
      for (const to of path) {
        const adjacent = path.indexOf(to) === path.indexOf(from) + 1;
        if (adjacent || legalExtras.some(([a, b]) => a === from && b === to)) continue;
        expect(canTransitionDeliveryStatus(from, to)).toBe(false);
      }
    }
  });
});

describe("Delivery status rank / forward progress", () => {
  it("ranks the happy path monotonically", () => {
    expect(DELIVERY_STATUS_RANK.DRAFT).toBeLessThan(DELIVERY_STATUS_RANK.QUEUED!);
    expect(DELIVERY_STATUS_RANK.QUEUED).toBeLessThan(DELIVERY_STATUS_RANK.SENDING!);
    expect(DELIVERY_STATUS_RANK.SENDING).toBeLessThan(DELIVERY_STATUS_RANK.SENT!);
    expect(DELIVERY_STATUS_RANK.SENT).toBeLessThan(DELIVERY_STATUS_RANK.DELIVERED!);
    expect(DELIVERY_STATUS_RANK.DELIVERED).toBeLessThan(DELIVERY_STATUS_RANK.READ!);
  });

  it("terminal side-states carry no rank", () => {
    expect(DELIVERY_STATUS_RANK.FAILED).toBeUndefined();
    expect(DELIVERY_STATUS_RANK.CANCELLED).toBeUndefined();
  });

  it("forward progress accepts strictly advancing receipts", () => {
    expect(isForwardProgress("QUEUED", "SENT")).toBe(true);
    expect(isForwardProgress("SENDING", "SENT")).toBe(true);
    expect(isForwardProgress("SENT", "DELIVERED")).toBe(true);
    expect(isForwardProgress("SENT", "READ")).toBe(true);
    expect(isForwardProgress("DELIVERED", "READ")).toBe(true);
  });

  it("forward progress rejects equality (duplicate receipts)", () => {
    for (const status of ["QUEUED", "SENDING", "SENT", "DELIVERED", "READ"] as const) {
      expect(isForwardProgress(status, status)).toBe(false);
    }
  });

  it("forward progress rejects regressions (READ → DELIVERED etc.)", () => {
    expect(isForwardProgress("READ", "DELIVERED")).toBe(false);
    expect(isForwardProgress("READ", "SENT")).toBe(false);
    expect(isForwardProgress("DELIVERED", "SENT")).toBe(false);
    expect(isForwardProgress("SENT", "SENDING")).toBe(false);
  });

  it("forward progress is undefined against terminal side-states", () => {
    expect(isForwardProgress("FAILED", "SENT")).toBe(false);
    expect(isForwardProgress("CANCELLED", "READ")).toBe(false);
    expect(isForwardProgress("SENT", "FAILED")).toBe(false);
  });
});

describe("DeliveryStateError", () => {
  it("is an Error with a stable name", () => {
    const error = new DeliveryStateError("boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DeliveryStateError");
    expect(error.message).toBe("boom");
  });
});
