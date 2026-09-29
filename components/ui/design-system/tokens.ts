/**
 * Brobond Enterprise Design System — Primitive Tokens (PR010.1)
 *
 * Typography, radius, elevation, blur and motion primitives. Together with
 * `colors.ts` and `spacing.ts` these are the *only* sanctioned raw values in
 * the product; components consume them through `theme.ts` semantic aliases or
 * through the matching Tailwind utilities.
 */

import { colors } from "./colors";
import { spacing, layout, breakpoints } from "./spacing";

/* ------------------------------------------------------------------ */
/* Typography — Inter                                                  */
/* ------------------------------------------------------------------ */

export const fontFamily = {
  sans: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/**
 * Type scale. Each step is `[fontSize, lineHeight, letterSpacing]` in rem/em.
 * Line heights land on the 4px sub-grid at the default 16px root size.
 */
export const fontSize = {
  "2xs": ["0.625rem", "0.875rem", "0.04em"],
  xs: ["0.75rem", "1rem", "0.01em"],
  sm: ["0.875rem", "1.25rem", "0em"],
  base: ["1rem", "1.5rem", "0em"],
  lg: ["1.125rem", "1.75rem", "-0.01em"],
  xl: ["1.375rem", "1.875rem", "-0.015em"],
  "2xl": ["1.75rem", "2.25rem", "-0.02em"],
  "3xl": ["2.25rem", "2.625rem", "-0.025em"],
  "4xl": ["3rem", "3.25rem", "-0.03em"],
} as const;

export type FontSizeToken = keyof typeof fontSize;

/** Named, role-based text styles used across pages. */
export const typography = {
  displayLg: { size: "4xl", weight: fontWeight.bold },
  display: { size: "3xl", weight: fontWeight.bold },
  pageTitle: { size: "2xl", weight: fontWeight.semibold },
  sectionTitle: { size: "lg", weight: fontWeight.semibold },
  cardTitle: { size: "sm", weight: fontWeight.semibold },
  metric: { size: "2xl", weight: fontWeight.semibold },
  body: { size: "sm", weight: fontWeight.regular },
  label: { size: "xs", weight: fontWeight.medium },
  caption: { size: "xs", weight: fontWeight.regular },
  overline: { size: "2xs", weight: fontWeight.semibold },
} as const satisfies Record<string, { size: FontSizeToken; weight: number }>;

/* ------------------------------------------------------------------ */
/* Radius — 16px is the product's signature corner                     */
/* ------------------------------------------------------------------ */

/** Signature corner radius, in pixels. Cards, panels and modals use it. */
export const BASE_RADIUS = 16;

export const radius = {
  none: "0px",
  xs: "6px",
  sm: "8px",
  md: "12px",
  /** Signature radius (16px) — the default for surfaces. */
  lg: "16px",
  xl: "20px",
  "2xl": "24px",
  full: "9999px",
} as const;

export type RadiusToken = keyof typeof radius;

/* ------------------------------------------------------------------ */
/* Elevation & blur                                                    */
/* ------------------------------------------------------------------ */

export const shadow = {
  none: "none",
  xs: "0 1px 2px rgba(0, 0, 0, 0.32)",
  sm: "0 2px 8px rgba(0, 0, 0, 0.28)",
  md: "0 8px 24px -8px rgba(0, 0, 0, 0.45)",
  lg: "0 16px 48px -12px rgba(0, 0, 0, 0.55)",
  xl: "0 28px 72px -18px rgba(0, 0, 0, 0.65)",
  /** Brand halo for primary CTAs and active nav affordances. */
  glow: `0 8px 32px -8px ${colors.brand[600]}66`,
  /** Inner top highlight that sells the glass effect. */
  innerHighlight: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
} as const;

export const blur = {
  none: "0px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "40px",
} as const;

/* ------------------------------------------------------------------ */
/* Motion — restrained by design                                       */
/* ------------------------------------------------------------------ */

/**
 * Durations in seconds (Framer Motion's unit). Nothing in the product is
 * allowed to exceed `slow`; enterprise users navigate fast and animation must
 * never gate an interaction.
 */
export const duration = {
  instant: 0.08,
  fast: 0.14,
  normal: 0.22,
  slow: 0.32,
} as const;

export const easing = {
  /** Default product curve — quick out, gentle settle. */
  standard: [0.22, 1, 0.36, 1],
  enter: [0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
} as const;

/** Z-index scale — the only place stacking order is decided. */
export const zIndex = {
  base: 0,
  raised: 10,
  sticky: 20,
  overlay: 30,
  drawer: 40,
  modal: 50,
  popover: 60,
  toast: 70,
} as const;

export const tokens = {
  colors,
  spacing,
  layout,
  breakpoints,
  fontFamily,
  fontWeight,
  fontSize,
  typography,
  radius,
  shadow,
  blur,
  duration,
  easing,
  zIndex,
} as const;

export type Tokens = typeof tokens;
