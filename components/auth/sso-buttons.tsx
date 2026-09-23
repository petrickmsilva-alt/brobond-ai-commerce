"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";

/**
 * Federated sign-in buttons (PR010.2 §4).
 *
 * THE RULE: "Nunca deixar botão desabilitado."
 *
 * PR010.1 rendered a permanently `disabled` Google button with an apologetic
 * caption. A control that can never be used is not a feature — it reads as a
 * broken page. So this component renders the button ONLY when the provider is
 * actually wired, and renders **nothing at all** otherwise.
 *
 * The decision is not made here. A Server Component calls
 * `showGoogleProvider()` (`lib/auth-providers.ts`) — the same predicate
 * `lib/auth.ts` uses to decide whether to register the provider — and passes
 * the resulting boolean down. UI and auth config therefore cannot drift: if
 * the button is visible, `/api/auth/signin/google` exists.
 *
 * SECURITY: this client component receives one boolean. `AUTH_GOOGLE_ID` and
 * `AUTH_GOOGLE_SECRET` are never serialized into the bundle.
 */

export interface SsoButtonsProps {
  /** Resolved server-side by `showGoogleProvider()`. */
  google: boolean;
  /** Sanitised post-login destination, forwarded to the OAuth callback. */
  callbackUrl?: string;
}

export function SsoButtons({ google, callbackUrl = "/dashboard" }: SsoButtonsProps) {
  const [pending, setPending] = React.useState(false);

  // §4: no provider → render nothing. Not a disabled button, not a caption.
  if (!google) return null;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          setPending(true);
          void signIn("google", { callbackUrl });
        }}
        aria-busy={pending}
        className={cn(
          "flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.04]",
          "text-sm font-medium text-white transition-[background-color,border-color] duration-150",
          "hover:border-white/20 hover:bg-white/[0.08]",
          focusRingRaised,
        )}
      >
        {pending ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : (
          <GoogleMark />
        )}
        {pending ? "Redirecionando…" : "Continuar com Google"}
      </button>
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
