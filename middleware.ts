import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  DEFAULT_AUTHENTICATED_REDIRECT,
  LOGIN_ROUTE,
  NEXT_PARAM,
  isAuthRoute,
  isProtectedRoute,
  isPublicRoute,
  resolveNext,
} from "@/lib/auth-routes";

/**
 * Edge middleware — the perimeter of the application (PR010.2 §2).
 *
 * WHY THIS EXISTS
 * ---------------
 * Before PR010.2 an unauthenticated visitor who typed `/dashboard` reached the
 * server component, where `requireUser()` threw an `AuthorizationError`. React
 * rendered the framework's error boundary: a white screen with a digest. The
 * user was never *told* to log in.
 *
 * The middleware turns that failure into an intent-preserving redirect —
 * `/login?next=/dashboard` — so the user signs in once and lands exactly where
 * they were going.
 *
 * DEFENCE IN DEPTH — NOT A REPLACEMENT FOR RBAC
 * ---------------------------------------------
 * This layer answers only "is there a session?". It deliberately does NOT
 * answer "may this role do this?". Every server component, server action and
 * route handler keeps its `requireUser` / `requireRole` / `requireOrganization`
 * guard, and every domain query keeps its `organizationId` scope. Middleware
 * is a UX affordance and a first filter; the authoritative checks stay where
 * the data is touched. Nothing about RBAC (§11) changes.
 *
 * WHY `getToken()` AND NOT `auth()`
 * ---------------------------------
 * This file runs in the Edge runtime, where Prisma Client cannot run.
 * `auth()` pulls in the Prisma adapter through `lib/auth.ts`, so importing it
 * here would break the build. `getToken()` only verifies and decrypts the JWT
 * session cookie with `AUTH_SECRET` — no database, Edge-safe, and it reads the
 * exact same cookie NextAuth issued. NextAuth itself is untouched.
 *
 * SECURITY: the `?next=` value is never trusted. It is re-sanitised by
 * `resolveNext()` here and again by the login action before any redirect
 * happens, so `/login?next=https://evil.example` cannot bounce a
 * freshly-authenticated user off-origin.
 */

/** `__Secure-` cookie prefix is used whenever the deployment is HTTPS. */
function usesSecureCookies(request: NextRequest): boolean {
  if (process.env.NEXTAUTH_URL?.startsWith("https://")) return true;
  return request.nextUrl.protocol === "https:";
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Auth endpoints, webhooks, OAuth callbacks and static assets are never
  // gated — some of them are how a session gets created in the first place.
  if (isPublicRoute(pathname)) return NextResponse.next();

  const protectedRoute = isProtectedRoute(pathname);
  const authRoute = isAuthRoute(pathname);

  // Nothing to decide on a public marketing page.
  if (!protectedRoute && !authRoute) return NextResponse.next();

  const secureCookie = usesSecureCookies(request);
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie,
    // NextAuth v5 derives the JWT salt from the cookie name; passing the same
    // name keeps decryption consistent between `__Secure-` and plain hosts.
    cookieName: secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token",
  });

  const authenticated = Boolean(token);

  // --- Unauthenticated hitting a protected route → /login?next=currentPath
  if (protectedRoute && !authenticated) {
    const loginUrl = new URL(LOGIN_ROUTE, request.url);
    // Preserve the querystring too: a filtered table URL survives the login.
    loginUrl.searchParams.set(NEXT_PARAM, `${pathname}${search}`);

    const response = NextResponse.redirect(loginUrl);
    // A redirect to a login screen must never be cached by a shared proxy —
    // otherwise one user's redirect could be served to another.
    response.headers.set("Cache-Control", "no-store, must-revalidate");
    return response;
  }

  // --- Authenticated hitting /login (etc.) → straight to their destination
  if (authRoute && authenticated) {
    const target = resolveNext(request.nextUrl.searchParams.get(NEXT_PARAM));
    return NextResponse.redirect(new URL(target || DEFAULT_AUTHENTICATED_REDIRECT, request.url));
  }

  return NextResponse.next();
}

/**
 * Matcher — everything except Next.js internals and static files.
 *
 * The fine-grained decision lives in `lib/auth-routes.ts` (a pure, unit-tested
 * module) rather than in this regex, so the protected list stays readable and
 * is verified by tests instead of by eyeballing a pattern.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
