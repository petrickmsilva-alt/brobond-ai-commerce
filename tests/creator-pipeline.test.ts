import { describe, expect, it } from "vitest";
import {
  CONTACTED_STATUSES,
  CREATOR_STATUSES,
  CREATOR_STATUS_LABELS,
  CREATOR_STATUS_TRANSITIONS,
  DEFAULT_CREATOR_STATUS,
  canTransitionCreatorStatus,
} from "@/modules/creators/interfaces/creator.interface";

/**
 * PR003 — the CRM status pipeline.
 *
 * NEW → QUALIFIED → CONTACTED → NEGOTIATING → ACTIVE, ARCHIVED as the
 * terminal side-state. The transition map is the single source of truth
 * used by `changeCreatorStatusAction` — an illegal jump must be
 * impossible, not merely discouraged.
 */

describe("CREATOR_STATUSES (funnel order)", () => {
  it("lists the six PR003 statuses in funnel order", () => {
    expect(CREATOR_STATUSES).toEqual([
      "NEW",
      "QUALIFIED",
      "CONTACTED",
      "NEGOTIATING",
      "ACTIVE",
      "ARCHIVED",
    ]);
  });

  it("has a pt-BR label for every status", () => {
    for (const status of CREATOR_STATUSES) {
      expect(typeof CREATOR_STATUS_LABELS[status]).toBe("string");
      expect(CREATOR_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it("defaults new profiles to NEW", () => {
    expect(DEFAULT_CREATOR_STATUS).toBe("NEW");
  });
});

describe("CREATOR_STATUS_TRANSITIONS (transition map)", () => {
  it("defines an entry for every status", () => {
    for (const status of CREATOR_STATUSES) {
      expect(Array.isArray(CREATOR_STATUS_TRANSITIONS[status])).toBe(true);
    }
  });

  it("allows self-transitions (idempotent re-set)", () => {
    for (const status of CREATOR_STATUSES) {
      expect(canTransitionCreatorStatus(status, status)).toBe(true);
    }
  });

  it("allows every one-step-forward move", () => {
    expect(canTransitionCreatorStatus("NEW", "QUALIFIED")).toBe(true);
    expect(canTransitionCreatorStatus("QUALIFIED", "CONTACTED")).toBe(true);
    expect(canTransitionCreatorStatus("CONTACTED", "NEGOTIATING")).toBe(true);
    expect(canTransitionCreatorStatus("NEGOTIATING", "ACTIVE")).toBe(true);
  });

  it("allows one-step-back moves (negotiation falls through)", () => {
    expect(canTransitionCreatorStatus("QUALIFIED", "NEW")).toBe(true);
    expect(canTransitionCreatorStatus("CONTACTED", "QUALIFIED")).toBe(true);
    expect(canTransitionCreatorStatus("NEGOTIATING", "CONTACTED")).toBe(true);
    expect(canTransitionCreatorStatus("ACTIVE", "NEGOTIATING")).toBe(true);
  });

  it("allows archiving from every live stage", () => {
    for (const status of ["NEW", "QUALIFIED", "CONTACTED", "NEGOTIATING", "ACTIVE"] as const) {
      expect(canTransitionCreatorStatus(status, "ARCHIVED")).toBe(true);
    }
  });

  it("only allows ARCHIVED → NEW (reactivation restarts the funnel)", () => {
    expect(canTransitionCreatorStatus("ARCHIVED", "NEW")).toBe(true);
    expect(canTransitionCreatorStatus("ARCHIVED", "QUALIFIED")).toBe(false);
    expect(canTransitionCreatorStatus("ARCHIVED", "CONTACTED")).toBe(false);
    expect(canTransitionCreatorStatus("ARCHIVED", "NEGOTIATING")).toBe(false);
    expect(canTransitionCreatorStatus("ARCHIVED", "ACTIVE")).toBe(false);
  });

  it("rejects illegal jumps (no skipping stages)", () => {
    expect(canTransitionCreatorStatus("NEW", "CONTACTED")).toBe(false);
    expect(canTransitionCreatorStatus("NEW", "NEGOTIATING")).toBe(false);
    expect(canTransitionCreatorStatus("NEW", "ACTIVE")).toBe(false);
    expect(canTransitionCreatorStatus("QUALIFIED", "NEGOTIATING")).toBe(false);
    expect(canTransitionCreatorStatus("QUALIFIED", "ACTIVE")).toBe(false);
    expect(canTransitionCreatorStatus("CONTACTED", "ACTIVE")).toBe(false);
  });

  it("rejects moving back from NEW (there is no stage before the funnel)", () => {
    expect(canTransitionCreatorStatus("NEW", "ARCHIVED")).toBe(true); // archive is allowed
    // NEW has no previous live stage — every other move is forward or archive.
    const allowed = CREATOR_STATUS_TRANSITIONS.NEW;
    expect(allowed).toEqual(["NEW", "QUALIFIED", "ARCHIVED"]);
  });

  it("never references an unknown status in the map", () => {
    for (const [from, targets] of Object.entries(CREATOR_STATUS_TRANSITIONS)) {
      expect(CREATOR_STATUSES).toContain(from as (typeof CREATOR_STATUSES)[number]);
      for (const target of targets) {
        expect(CREATOR_STATUSES).toContain(target);
      }
    }
  });
});

describe("canTransitionCreatorStatus (guard)", () => {
  it("is a pure function of (from, to)", () => {
    expect(canTransitionCreatorStatus("NEW", "QUALIFIED")).toBe(
      canTransitionCreatorStatus("NEW", "QUALIFIED"),
    );
  });

  it("answers every (from, to) pair without throwing", () => {
    for (const from of CREATOR_STATUSES) {
      for (const to of CREATOR_STATUSES) {
        expect(() => canTransitionCreatorStatus(from, to)).not.toThrow();
      }
    }
  });

  it("the full pipeline walk is legal, end to end", () => {
    const walk = ["NEW", "QUALIFIED", "CONTACTED", "NEGOTIATING", "ACTIVE"] as const;
    for (let i = 0; i < walk.length - 1; i += 1) {
      expect(canTransitionCreatorStatus(walk[i]!, walk[i + 1]!)).toBe(true);
    }
  });

  it("the archive → reactivate → full walk is legal", () => {
    expect(canTransitionCreatorStatus("ACTIVE", "ARCHIVED")).toBe(true);
    expect(canTransitionCreatorStatus("ARCHIVED", "NEW")).toBe(true);
    expect(canTransitionCreatorStatus("NEW", "QUALIFIED")).toBe(true);
  });
});

describe("CONTACTED_STATUSES (KPI definition)", () => {
  it("counts CONTACTED, NEGOTIATING and ACTIVE as contacted", () => {
    expect(CONTACTED_STATUSES).toEqual(["CONTACTED", "NEGOTIATING", "ACTIVE"]);
  });

  it("excludes the pre-outreach and terminal statuses", () => {
    expect(CONTACTED_STATUSES).not.toContain("NEW");
    expect(CONTACTED_STATUSES).not.toContain("QUALIFIED");
    expect(CONTACTED_STATUSES).not.toContain("ARCHIVED");
  });
});
