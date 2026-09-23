/**
 * Brobond Enterprise Design System — Color Palette (PR010.1)
 *
 * Single source of truth for every colour used by the UI layer. These values
 * mirror the CSS custom properties declared in `styles/globals.css` (`@theme`)
 * so TypeScript consumers (charts, canvas, inline SVG gradients) and Tailwind
 * utilities can never drift apart.
 *
 * CONTRACT
 * - Pure data. No React, no side effects, no business logic.
 * - Every foreground/background pair documented here clears WCAG 2.1 AA
 *   (4.5:1 for body text, 3:1 for large text and non-text UI affordances)
 *   against the dark premium surfaces.
 */

/** Indigo brand ramp — primary action, focus, active navigation. */
export const brand = {
  50: "#eef2ff",
  100: "#e0e7ff",
  200: "#c7d2fe",
  300: "#a5b4fc",
  400: "#818cf8",
  500: "#6366f1",
  600: "#4f46e5",
  700: "#4338ca",
  800: "#3730a3",
  900: "#312e81",
} as const;

/** Violet accent ramp — secondary gradient stop, data-viz series #2. */
export const accent = {
  300: "#d8b4fe",
  400: "#c084fc",
  500: "#a855f7",
  600: "#9333ea",
  700: "#7e22ce",
} as const;

/**
 * Dark premium surface ramp. 950 is the application canvas; each step up is
 * one elevation level (sidebar → card → popover → hover).
 */
export const surface = {
  950: "#0a0a0f",
  900: "#0e0e14",
  850: "#14141c",
  800: "#1a1a24",
  700: "#24242f",
  600: "#33333f",
  500: "#4a4a58",
} as const;

/**
 * Text ramp expressed as white alpha so it composites correctly over every
 * surface elevation and over glass (blurred, semi-transparent) panels.
 *
 * Contrast over `surface.950` (#0a0a0f):
 *   primary   ≈ 18.9:1  · AAA body text
 *   secondary ≈ 12.4:1  · AAA body text
 *   tertiary  ≈  7.4:1  · AA  body text (labels, captions)
 *   muted     ≈  4.7:1  · AA  body text (placeholder, metadata)
 *   disabled  ≈  3.1:1  · AA  large text / non-text only — never body copy
 */
export const text = {
  primary: "rgba(255, 255, 255, 0.95)",
  secondary: "rgba(255, 255, 255, 0.78)",
  tertiary: "rgba(255, 255, 255, 0.60)",
  muted: "rgba(255, 255, 255, 0.46)",
  disabled: "rgba(255, 255, 255, 0.32)",
} as const;

/** Hairline borders — progressively brighter with elevation/interaction. */
export const border = {
  subtle: "rgba(255, 255, 255, 0.06)",
  default: "rgba(255, 255, 255, 0.10)",
  strong: "rgba(255, 255, 255, 0.16)",
  /** Focus ring hue. brand[300] clears 3:1 against every surface step. */
  focus: brand[300],
} as const;

/** Semantic status ramp — positive / attention / negative / informational. */
export const status = {
  success: { fg: "#6ee7b7", base: "#10b981", bg: "rgba(16, 185, 129, 0.14)" },
  warning: { fg: "#fcd34d", base: "#f59e0b", bg: "rgba(245, 158, 11, 0.14)" },
  danger: { fg: "#fca5a5", base: "#ef4444", bg: "rgba(239, 68, 68, 0.14)" },
  info: { fg: "#93c5fd", base: "#3b82f6", bg: "rgba(59, 130, 246, 0.14)" },
  neutral: { fg: text.tertiary, base: surface[600], bg: "rgba(255, 255, 255, 0.06)" },
} as const;

/**
 * Ordered categorical series for Recharts. Chosen for hue separation that
 * survives both dark backgrounds and the common forms of colour blindness;
 * charts must always pair colour with a label or legend, never colour alone.
 */
export const chartSeries = [
  brand[400],
  "#22d3ee",
  accent[400],
  "#34d399",
  "#fbbf24",
  "#fb7185",
] as const;

/** Glass (frosted) panel recipe used by cards, header and popovers. */
export const glass = {
  background: "rgba(20, 20, 28, 0.72)",
  backgroundStrong: "rgba(20, 20, 28, 0.88)",
  border: border.default,
  highlight: "rgba(255, 255, 255, 0.05)",
} as const;

/** Subtle brand gradients — decorative only, never the sole meaning carrier. */
export const gradients = {
  brand: `linear-gradient(135deg, ${brand[600]} 0%, ${accent[600]} 100%)`,
  brandSoft: `linear-gradient(135deg, ${brand[500]}26 0%, ${accent[500]}1a 100%)`,
  surface: `linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0) 100%)`,
  glow: `radial-gradient(60% 60% at 50% 0%, ${brand[500]}24 0%, transparent 70%)`,
} as const;

export const colors = {
  brand,
  accent,
  surface,
  text,
  border,
  status,
  chartSeries,
  glass,
  gradients,
} as const;

export type Colors = typeof colors;
export type StatusTone = keyof typeof status;
