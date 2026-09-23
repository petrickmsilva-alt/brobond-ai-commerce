"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";

/**
 * SsoButtons (PR010.1) — federated sign-in affordances.
 *
 * PRESENTATION ONLY, AND DELIBERATELY DISABLED.
 *
 * The NextAuth v5 configuration (`lib/auth.ts`) currently registers exactly
 * one provider: Credentials. Rendering an *enabled* Google button would post
 * to `/api/auth/signin/google`, which does not exist — a broken promise to the
 * user and a support ticket waiting to happen.
 *
 * So the button ships in its final visual form but `disabled`, with an
 * explicit explanation. Turning it on is a one-line auth-domain change
 * (register the Google provider + its credentials) in a future PR; no UI work
 * will be required.
 */
export function SsoButtons() {
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled
        aria-describedby="sso-hint"
        className={cn(
          "flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.04]",
          "text-sm font-medium text-white/70 transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-55",
          focusRingRaised,
        )}
      >
        <GoogleMark />
        Continuar com Google
      </button>

      <p
        id="sso-hint"
        className="flex items-start gap-1.5 text-[11px] leading-relaxed text-white/35"
      >
        <Info aria-hidden className="mt-px h-3 w-3 shrink-0" />
        SSO com Google será habilitado quando o provedor for provisionado pela sua organização.
      </p>
    </div>
  );
}

/** Google "G" mark, inlined so the form needs no external asset request. */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.58-5.17 3.58-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.75 12 4.75Z"
      />
    </svg>
  );
}
