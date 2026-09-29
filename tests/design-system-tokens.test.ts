import { describe, expect, it } from "vitest";
import {
  colors,
  border,
  brand,
  surface,
  status,
  chartSeries,
} from "@/components/ui/design-system/colors";
import {
  BASE_UNIT,
  spacing,
  space,
  units,
  layout,
  breakpoints,
  mediaUp,
} from "@/components/ui/design-system/spacing";
import {
  BASE_RADIUS,
  radius,
  fontSize,
  typography,
  duration,
  zIndex,
  tokens,
} from "@/components/ui/design-system/tokens";
import theme, { focusRing, chartTheme, motionPresets } from "@/components/ui/design-system/theme";

/**
 * PR010.1 — Design System contract tests.
 *
 * These lock the primitives the whole UI is built on. A token drifting
 * silently (a radius, an 8pt step, a contrast-critical colour) would degrade
 * every screen at once, so the contract is asserted rather than assumed.
 */

/** Relative luminance per WCAG 2.1, from an #rrggbb string. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const part = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two opaque hex colours. */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

describe("design system — spacing (8pt grid)", () => {
  it("uses an 8px base unit", () => {
    expect(BASE_UNIT).toBe(8);
  });

  it("keeps every full step on the 8pt grid", () => {
    const fullSteps = Object.entries(spacing).filter(([token]) => Number.isInteger(Number(token)));
    for (const [token, value] of fullSteps) {
      expect(value % BASE_UNIT, `spacing[${token}] = ${value} is off the 8pt grid`).toBe(0);
    }
  });

  it("sanctions exactly two half-steps, both on the 4px sub-grid", () => {
    const halfSteps = Object.entries(spacing).filter(([token]) => !Number.isInteger(Number(token)));
    expect(halfSteps.map(([token]) => token)).toEqual(["0.5", "1.5"]);
    for (const [, value] of halfSteps) {
      expect(value % 4).toBe(0);
    }
  });

  it("increases monotonically", () => {
    const values = Object.entries(spacing)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, value]) => value);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeGreaterThan(values[index - 1]!);
    }
  });

  it("exposes px and multiplier helpers", () => {
    expect(space(3)).toBe("24px");
    expect(units(3)).toBe(24);
    expect(units(0)).toBe(0);
  });

  it("keeps the shell dimensions on the grid and ordered", () => {
    expect(layout.headerHeight % BASE_UNIT).toBe(0);
    expect(layout.sidebarWidth % BASE_UNIT).toBe(0);
    expect(layout.sidebarCollapsedWidth).toBeLessThan(layout.sidebarWidth);
  });

  it("orders the breakpoints ascending and builds min-width queries", () => {
    const values = Object.values(breakpoints);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeGreaterThan(values[index - 1]!);
    }
    expect(mediaUp("lg")).toBe("(min-width: 1024px)");
  });
});

describe("design system — radius", () => {
  it("pins the signature corner at 16px", () => {
    expect(BASE_RADIUS).toBe(16);
    expect(radius.lg).toBe("16px");
  });

  it("keeps the pill radius effectively infinite", () => {
    expect(radius.full).toBe("9999px");
  });
});

describe("design system — typography", () => {
  it("leads the sans stack with Inter", () => {
    expect(tokens.fontFamily.sans.startsWith('"Inter"')).toBe(true);
  });

  it("declares size, line-height and tracking for every step", () => {
    for (const [token, value] of Object.entries(fontSize)) {
      expect(value, `fontSize[${token}]`).toHaveLength(3);
      expect(value[0].endsWith("rem")).toBe(true);
    }
  });

  it("maps every named role to a real size token", () => {
    for (const [role, style] of Object.entries(typography)) {
      expect(fontSize[style.size], `typography.${role} → ${style.size}`).toBeDefined();
    }
  });
});

describe("design system — colors & accessibility", () => {
  it("keeps body text above the WCAG AA 4.5:1 threshold on the canvas", () => {
    // `text.primary` is white at 95% alpha; over #0a0a0f it composites to
    // ~#f2f2f3. Assert the opaque extreme (#ffffff) and the darkest sanctioned
    // body tone still clear AA.
    expect(contrast("#ffffff", surface[950])).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#b3b3b8", surface[950])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the focus ring above the 3:1 non-text threshold on EVERY surface step", () => {
    // WCAG 2.1 §1.4.11 (non-text contrast). This is why the ring is brand-300
    // and not brand-400: the latter only reaches 2.92:1 against surface-500.
    for (const [step, value] of Object.entries(surface)) {
      expect(
        contrast(border.focus, value),
        `focus ring over surface-${step}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("pins the focus ring to the brand ramp", () => {
    expect(border.focus).toBe(brand[300]);
  });

  it("keeps every status foreground legible on the canvas", () => {
    for (const [tone, palette] of Object.entries(status)) {
      if (!palette.fg.startsWith("#")) continue; // `neutral` uses an alpha token
      expect(contrast(palette.fg, surface[950]), `status.${tone}.fg`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("orders the surface ramp from darkest canvas to lightest elevation", () => {
    const ordered = [
      surface[950],
      surface[900],
      surface[850],
      surface[800],
      surface[700],
      surface[600],
      surface[500],
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(luminance(ordered[index]!)).toBeGreaterThan(luminance(ordered[index - 1]!));
    }
  });

  it("gives every categorical chart series a distinct colour", () => {
    expect(new Set(chartSeries).size).toBe(chartSeries.length);
    expect(chartSeries.length).toBeGreaterThanOrEqual(5);
  });

  it("re-exports the full palette from the aggregate", () => {
    expect(colors.brand).toBe(brand);
    expect(colors.surface).toBe(surface);
  });
});

describe("design system — motion", () => {
  it("keeps every duration short enough to never gate an interaction", () => {
    for (const [name, value] of Object.entries(duration)) {
      expect(value, `duration.${name}`).toBeGreaterThan(0);
      expect(value, `duration.${name}`).toBeLessThanOrEqual(0.32);
    }
  });

  it("keeps entrance offsets subtle (≤ 16px)", () => {
    const offsets = [
      motionPresets.fadeUp.initial.y,
      Math.abs(motionPresets.slideIn.initial.x),
      Math.abs(motionPresets.popIn.initial.y),
    ];
    for (const offset of offsets) {
      expect(offset).toBeLessThanOrEqual(16);
    }
  });

  it("never overshoots on scale", () => {
    expect(motionPresets.popIn.initial.scale).toBeLessThan(1);
    expect(motionPresets.popIn.animate.scale).toBe(1);
  });
});

describe("design system — theme recipes", () => {
  it("makes the focus ring keyboard-only", () => {
    expect(focusRing).toContain("focus-visible:ring-2");
    expect(focusRing).not.toMatch(/(^|\s)focus:ring/);
  });

  it("orders the z-index scale without collisions", () => {
    const values = Object.values(zIndex);
    expect(new Set(values).size).toBe(values.length);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeGreaterThan(values[index - 1]!);
    }
    expect(zIndex.modal).toBeGreaterThan(zIndex.sticky);
    expect(zIndex.toast).toBeGreaterThan(zIndex.modal);
  });

  it("reuses the shared chart palette", () => {
    expect(chartTheme.series).toBe(chartSeries);
  });

  it("exposes every layer through the aggregate theme", () => {
    for (const key of ["colors", "spacing", "radius", "recipes", "motion", "chart"] as const) {
      expect(theme[key]).toBeDefined();
    }
  });
});
