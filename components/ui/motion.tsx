"use client";

import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { duration, easing } from "@/components/ui/design-system/tokens";

/**
 * Motion primitives (PR010.1).
 *
 * Thin wrappers over framer-motion that encode the product's restraint:
 * short distances (8px), short durations (≤320ms) and no overshoot. They also
 * honour `prefers-reduced-motion` at the component level — when a user asks
 * for reduced motion the element renders in its final state with no animation
 * at all, rather than merely animating faster.
 */

const EASE = [...easing.standard] as [number, number, number, number];

/**
 * Props accepted by every primitive. `children` and `className` are narrowed
 * to plain React types (framer-motion widens `children` to include
 * `MotionValue`, which a plain `<div>` cannot render) so the reduced-motion
 * fallback and the animated branch share one signature.
 */
export interface MotionBoxProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children?: React.ReactNode;
  /** Stagger helper: delay in seconds applied before the animation starts. */
  delay?: number;
}

/** Reduced-motion fallback: the same box, already in its final state. */
function StaticBox({
  children,
  className,
  id,
  style,
  role,
}: Pick<MotionBoxProps, "children" | "className" | "id" | "style" | "role">) {
  return (
    <div className={className} id={id} style={style as React.CSSProperties} role={role}>
      {children}
    </div>
  );
}

/** Fade + 8px rise. The default entrance for sections and cards. */
export function FadeIn({ delay = 0, children, ...props }: MotionBoxProps) {
  const reduced = useReducedMotion();
  if (reduced) return <StaticBox {...props}>{children}</StaticBox>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.normal, ease: EASE, delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Horizontal slide — used by drawers and side panels. */
export function SlideIn({ delay = 0, children, ...props }: MotionBoxProps) {
  const reduced = useReducedMotion();
  if (reduced) return <StaticBox {...props}>{children}</StaticBox>;

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: duration.normal, ease: EASE, delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Staggered grid/list container — pair with `StaggerItem`. */
export function Stagger({ children, ...props }: MotionBoxProps) {
  const reduced = useReducedMotion();
  if (reduced) return <StaticBox {...props}>{children}</StaticBox>;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Item of a `Stagger` container. */
export function StaggerItem({ children, ...props }: MotionBoxProps) {
  const reduced = useReducedMotion();
  if (reduced) return <StaticBox {...props}>{children}</StaticBox>;

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0, transition: { duration: duration.normal, ease: EASE } },
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
