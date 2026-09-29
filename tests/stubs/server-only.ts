/**
 * No-op stub for the `server-only` build-time guard.
 *
 * Next.js resolves `server-only` to a module that throws when bundled for the
 * browser. Under Vitest (Node environment) there is no bundler, so we alias it
 * to this empty module — see `vitest.config.ts`.
 */
export {};
