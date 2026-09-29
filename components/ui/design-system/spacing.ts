/**
 * Brobond Enterprise Design System — Spacing (PR010.1)
 *
 * Strict 8pt grid. Every margin, padding and gap in the product resolves to a
 * key of `spacing` below. The two sub-steps (`0.5` = 4px, `1.5` = 12px) are the
 * only sanctioned half-steps; they exist for dense control chrome (icon
 * paddings, badge insets) where a full 8px step breaks optical alignment.
 *
 * Values are plain pixel numbers so they can be consumed by Recharts margins,
 * inline styles and Tailwind arbitrary values alike.
 */

/** 8pt base unit, in pixels. */
export const BASE_UNIT = 8;

export const spacing = {
  0: 0,
  0.5: 4,
  1: 8,
  1.5: 12,
  2: 16,
  3: 24,
  4: 32,
  5: 40,
  6: 48,
  7: 56,
  8: 64,
  10: 80,
  12: 96,
  16: 128,
} as const;

export type SpacingToken = keyof typeof spacing;

/** Resolve a spacing token to a `px` string. */
export function space(token: SpacingToken): string {
  return `${spacing[token]}px`;
}

/** Multiply the 8pt base unit — `units(3)` → 24. */
export function units(multiplier: number): number {
  return BASE_UNIT * multiplier;
}

/**
 * Canonical layout dimensions. The shell reads these so sidebar width, header
 * height and content gutters stay in lockstep across breakpoints.
 */
export const layout = {
  /** Expanded sidebar rail width. */
  sidebarWidth: 264,
  /** Collapsed (icon-only) sidebar rail width. */
  sidebarCollapsedWidth: 76,
  /** Sticky header height. */
  headerHeight: 64,
  /** Max readable width of a content column. */
  contentMaxWidth: 1600,
  /** Horizontal page gutters per breakpoint. */
  gutter: { mobile: spacing[2], tablet: spacing[3], desktop: spacing[4] },
} as const;

/**
 * Breakpoints (min-width, px) — aligned with Tailwind defaults plus an
 * `ultra` tier for 1440+ enterprise monitors.
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
  ultra: 1920,
} as const;

export type Breakpoint = keyof typeof breakpoints;

/** Build a `min-width` media query string for a breakpoint. */
export function mediaUp(breakpoint: Breakpoint): string {
  return `(min-width: ${breakpoints[breakpoint]}px)`;
}
