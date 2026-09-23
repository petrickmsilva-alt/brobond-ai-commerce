/**
 * Brobond Enterprise Design System — Semantic Theme (PR010.1)
 *
 * Maps the primitive tokens onto *roles* ("what is this used for") and exposes
 * ready-made Tailwind class recipes so every surface, control and state looks
 * identical across the product.
 *
 * WHY CLASS RECIPES
 * Tailwind v4 is configured CSS-first (`styles/globals.css#@theme`), so the
 * ramps below already exist as utilities (`bg-surface-850`, `text-brand-300`…).
 * The recipes are plain strings — zero runtime cost, fully static-analysable by
 * Tailwind, and composable with `cn()`.
 *
 * This module is framework-agnostic data: no React, no framer-motion import,
 * so it is safe in both Server and Client Components.
 */

import { colors } from "./colors";
import { spacing, layout, breakpoints } from "./spacing";
import { radius, shadow, blur, duration, easing, zIndex, typography, fontSize } from "./tokens";

/* ------------------------------------------------------------------ */
/* Semantic roles                                                      */
/* ------------------------------------------------------------------ */

export const semantic = {
  background: {
    /** Application canvas. */
    canvas: colors.surface[950],
    /** Navigation rails and sticky chrome. */
    chrome: colors.surface[900],
    /** Default raised surface (cards, panels). */
    raised: colors.surface[850],
    /** Inputs, wells, table headers. */
    sunken: colors.surface[900],
    /** Hover state of an interactive surface. */
    hover: colors.surface[800],
    /** Frosted overlay surface. */
    glass: colors.glass.background,
  },
  foreground: {
    primary: colors.text.primary,
    secondary: colors.text.secondary,
    tertiary: colors.text.tertiary,
    muted: colors.text.muted,
    onBrand: "#ffffff",
  },
  border: colors.border,
  interactive: {
    primary: colors.brand[600],
    primaryHover: colors.brand[500],
    primaryActive: colors.brand[700],
    focusRing: colors.brand[400],
  },
  feedback: colors.status,
} as const;

/* ------------------------------------------------------------------ */
/* Tailwind class recipes                                              */
/* ------------------------------------------------------------------ */

/**
 * Focus ring applied to every focusable element. Keyboard-only
 * (`focus-visible`) so pointer users never see it, 2px at 3:1+ contrast
 * against all surfaces — WCAG 2.1 AA (2.4.7 / 1.4.11).
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950";

/** Same ring, offset against a raised surface instead of the canvas. */
export const focusRingRaised =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900";

/** Frosted glass panel: translucent fill + backdrop blur + top highlight. */
export const glassSurface =
  "border border-white/10 bg-surface-850/70 backdrop-blur-xl shadow-[0_16px_48px_-12px_rgba(0,0,0,0.55)] " +
  "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px " +
  "before:bg-gradient-to-r before:from-transparent before:via-white/15 before:to-transparent";

/** Stronger, more opaque glass for floating layers (popovers, drawers). */
export const glassOverlay =
  "border border-white/10 bg-surface-900/90 backdrop-blur-2xl shadow-[0_28px_72px_-18px_rgba(0,0,0,0.65)]";

/** Signature card: 16px radius, gradient wash, elegant hover lift. */
export const cardSurface =
  "relative overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-b from-white/[0.045] to-transparent " +
  "bg-surface-850 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)]";

/** Hover treatment for interactive cards — subtle, never bouncy. */
export const cardHover =
  "transition-[border-color,box-shadow,background-color] duration-200 ease-out " +
  "hover:border-white/15 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.55)]";

/** Decorative brand gradients. */
export const gradientText =
  "bg-gradient-to-r from-white via-white to-brand-200 bg-clip-text text-transparent";
export const gradientBrand = "bg-gradient-to-br from-brand-600 to-accent-600";
export const gradientBrandSoft = "bg-gradient-to-br from-brand-500/20 to-accent-500/10";

/** Screen-reader-only content that stays reachable by assistive tech. */
export const srOnly = "sr-only";

/** Skeleton shimmer used by every loading placeholder. */
export const skeleton = "animate-pulse rounded-lg bg-white/[0.06]";

export const recipes = {
  focusRing,
  focusRingRaised,
  glassSurface,
  glassOverlay,
  cardSurface,
  cardHover,
  gradientText,
  gradientBrand,
  gradientBrandSoft,
  srOnly,
  skeleton,
} as const;

/* ------------------------------------------------------------------ */
/* Motion presets                                                      */
/* ------------------------------------------------------------------ */

/**
 * Framer Motion variants shared by the whole product. Typed structurally
 * (not against framer-motion) so this module stays importable from Server
 * Components. Motion is deliberately restrained: short distances, short
 * durations, no springs that overshoot.
 *
 * Every consumer must also respect `prefers-reduced-motion`; the global
 * stylesheet neutralises transitions/animations for those users.
 */
const EASE = [...easing.standard] as [number, number, number, number];

export const motionPresets = {
  /** Plain opacity fade — default for content swaps. */
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: duration.normal, ease: EASE },
  },
  /** Fade + 8px rise — page sections and cards entering the viewport. */
  fadeUp: {
    initial: { opacity: 0, y: spacing[1] },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: spacing[1] },
    transition: { duration: duration.normal, ease: EASE },
  },
  /** Horizontal slide — drawers and side panels. */
  slideIn: {
    initial: { opacity: 0, x: -spacing[2] },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -spacing[2] },
    transition: { duration: duration.normal, ease: EASE },
  },
  /** Scale-in for popovers/menus anchored to a trigger. */
  popIn: {
    initial: { opacity: 0, scale: 0.98, y: -spacing[0.5] },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: -spacing[0.5] },
    transition: { duration: duration.fast, ease: EASE },
  },
} as const;

/** Parent variant that staggers children by 40ms (grids, lists, KPI rows). */
export const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
} as const;

/** Child variant paired with `staggerContainer`. */
export const staggerItem = {
  hidden: { opacity: 0, y: spacing[1] },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.normal, ease: EASE },
  },
} as const;

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

/** Shared Recharts styling so every chart in the product reads as one family. */
export const chartTheme = {
  series: colors.chartSeries,
  grid: "rgba(255, 255, 255, 0.06)",
  axis: colors.text.muted,
  axisFontSize: 11,
  cursor: "rgba(255, 255, 255, 0.06)",
  tooltip: {
    background: colors.glass.backgroundStrong,
    border: colors.border.default,
    radius: radius.md,
    color: colors.text.primary,
  },
  margin: { top: spacing[1], right: spacing[1], bottom: 0, left: 0 },
} as const;

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export const theme = {
  colors,
  semantic,
  spacing,
  layout,
  breakpoints,
  radius,
  shadow,
  blur,
  duration,
  easing,
  zIndex,
  typography,
  fontSize,
  recipes,
  motion: motionPresets,
  chart: chartTheme,
} as const;

export type Theme = typeof theme;
export default theme;
