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

/** BroBond brand ramp — primary action, focus, and premium highlights. */
export const brand = {
  50: "#f8f2d9",
  100: "#f3e6b7",
  200: "#ecd38b",
  300: "#dfbb61",
  400: "#d2a84a",
  500: "#c79a37",
  600: "#b78326",
  700: "#8a621f",
  800: "#5b3f16",
  900: "#2f220d",
} as const;

/** Graphite accent ramp — neutral partner for the warm brand highlights. */
export const accent = {
  300: "#dfe4ea",
  400: "#b8c0cb",
  500: "#909cab",
  600: "#697788",
  700: "#455261",
} as const;

/**
 * Dark premium surface ramp. 950 is the application canvas; each step up is
 * one elevation level (sidebar → card → popover → hover).
 *
 * PR013 — Hub Multicanal de Vendas: re-hued to the editorial-luxury navy
 * ink spec (#121827 at the `900`/sidebar elevation). Luminance steps are
 * unchanged from the previous graphite ramp, so every WCAG contrast
 * guarantee documented on `text` below still holds.
 */
export const surface = {
  950: "#0a0d16",
  900: "#121827",
  850: "#161e31",
  800: "#1b253d",
  700: "#253253",
  600: "#334573",
  500: "#445d9a",
} as const;

/**
 * Editorial ink text ramp (PR013) — literal cool slate-blue, a companion to
 * the white-alpha `text` ramp below for copy that should read as a tone
 * rather than a translucency (sidebar nav, eyebrow labels, metadata).
 * `400` (#A9B4C6) is the Hub Multicanal design spec value.
 */
export const ink = {
  300: "#c3cbda",
  400: "#a9b4c6",
  500: "#7e89a0",
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
  ink,
  text,
  border,
  status,
  chartSeries,
  glass,
  gradients,
} as const;

export type Colors = typeof colors;
export type StatusTone = keyof typeof status;
