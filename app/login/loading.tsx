import { AuthCardSkeleton } from "@/components/ui/skeleton";

/**
 * Login route loading state (PR010.2 §9 — "Loading Login").
 *
 * `/login` is now an async Server Component: it resolves the session (to
 * redirect an already-authenticated visitor) and reads provider availability
 * before rendering. This fallback keeps the branded surface on screen during
 * that resolution instead of flashing a blank page — the first impression of
 * the product for anyone signing in.
 */
export default function LoginLoading() {
  return (
    <div className="bg-app-mesh flex min-h-screen items-center justify-center px-4 py-12 sm:px-8">
      <div className="w-full max-w-sm">
        <AuthCardSkeleton fields={2} />
      </div>
    </div>
  );
}
