"use client";

import { PASSWORD_MIN_LENGTH } from "@/lib/validations/auth";
import { cn } from "@/lib/utils";

/**
 * Password strength meter (PR010.2 §6/§7).
 *
 * ADVISORY ONLY — it never blocks a submit. The authoritative policy is the
 * Zod schema on the server (`passwordSchema`: 8–256 characters); this widget
 * exists so a user choosing a new password gets feedback while typing instead
 * of after a round trip.
 *
 * Scoring is deliberately simple and local: length plus character-class
 * variety. No password is ever sent anywhere to be scored.
 */

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

const LABELS: Record<StrengthLevel, { label: string; bar: string; text: string }> = {
  0: { label: "Muito fraca", bar: "bg-red-400", text: "text-red-300" },
  1: { label: "Fraca", bar: "bg-red-400", text: "text-red-300" },
  2: { label: "Razoável", bar: "bg-amber-400", text: "text-amber-300" },
  3: { label: "Forte", bar: "bg-emerald-400", text: "text-emerald-300" },
  4: { label: "Muito forte", bar: "bg-emerald-400", text: "text-emerald-300" },
};

/** Pure scorer — exported so it can be unit-tested without React. */
export function scorePassword(password: string): StrengthLevel {
  if (!password) return 0;

  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (password.length >= 12) score += 1;

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (classes >= 3) score += 1;
  if (classes === 4) score += 1;

  // A password below the minimum length can never read as anything but weak,
  // however exotic its characters.
  if (password.length < PASSWORD_MIN_LENGTH) return Math.min(score, 1) as StrengthLevel;

  return Math.min(score, 4) as StrengthLevel;
}

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;

  const score = scorePassword(password);
  const config = LABELS[score];

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200",
              step <= score ? config.bar : "bg-white/10",
            )}
          />
        ))}
      </div>
      {/* The text carries the meaning — colour is never the only signal. */}
      <p className={cn("text-[11px] font-medium", config.text)} aria-live="polite">
        Força da senha: {config.label}
      </p>
    </div>
  );
}
