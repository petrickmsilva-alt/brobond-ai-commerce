import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_SHORT_NAME } from "@/lib/constants";
import { DEFAULT_AUTHENTICATED_REDIRECT, LOGIN_ROUTE, buildLoginUrl } from "@/lib/auth-routes";

/**
 * Landing header (PR010.2 §1).
 *
 * THE BUG THIS FIXES
 * ------------------
 * PR010.1's header linked "Dashboard" straight at `/dashboard`. A visitor who
 * clicked it without a session reached a server component whose
 * `requireUser()` threw, and React rendered a blank error page with a digest.
 * The most prominent button on the marketing site led to a white screen.
 *
 * THE RULE (§1): the Dashboard CTA NEVER navigates blindly.
 *   - sessão válida  → `/dashboard`
 *   - caso contrário → `/login?next=/dashboard`
 *
 * The decision is made on the server (the parent Server Component resolves
 * the session and passes `authenticated` down), so the correct href is in the
 * HTML on first paint — no flash of the wrong link, no client-side redirect,
 * and it works with JavaScript disabled.
 *
 * `buildLoginUrl()` — the same sanitiser the middleware uses — builds the
 * fallback, so the landing page and the perimeter can never disagree about
 * where an unauthenticated user goes.
 *
 * This component is a Server Component: it receives one boolean and holds no
 * state. It never sees the session object itself.
 */

export interface LandingHeaderProps {
  /** Resolved server-side by the page. `false` when there is no session. */
  authenticated: boolean;
}

export function LandingHeader({ authenticated }: LandingHeaderProps) {
  // The entire §1 contract, in one line.
  const dashboardHref = authenticated
    ? DEFAULT_AUTHENTICATED_REDIRECT
    : buildLoginUrl(DEFAULT_AUTHENTICATED_REDIRECT);

  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <Link
        href="/"
        className="flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950"
        aria-label={`${APP_SHORT_NAME} — início`}
      >
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 shadow-[0_8px_24px_-8px_rgba(79,70,229,0.9)]"
        >
          <Sparkles className="h-5 w-5 text-white" />
        </span>
        <span className="text-base font-semibold text-white">{APP_SHORT_NAME}</span>
      </Link>

      <nav className="flex items-center gap-2" aria-label="Acesso à plataforma">
        {/* "Entrar" is always /login — §1. */}
        <Link href={LOGIN_ROUTE}>
          <Button variant="ghost" size="sm">
            Entrar
          </Button>
        </Link>

        <Link href={dashboardHref} data-testid="landing-dashboard-cta">
          <Button size="sm">
            Dashboard
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Button>
        </Link>
      </nav>
    </header>
  );
}
