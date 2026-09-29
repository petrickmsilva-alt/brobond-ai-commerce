import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration — unit tests for the auth / RBAC / tenancy layer.
 *
 * `server-only` is aliased to a no-op stub so server modules (which import it
 * as a build-time guard) can be exercised in a plain Node test environment.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    env: {
      DATABASE_URL: "postgresql://user:pass@localhost:5432/brobond_test",
      AUTH_SECRET: "vitest-secret-not-used-outside-tests",
      NEXTAUTH_URL: "http://localhost:3000",
    },
  },
  // PR010.3 — page-component tests execute Server Components directly
  // (e.g. the /invite/[token] redirect contract). The automatic JSX runtime
  // compiles that JSX without requiring `React` in scope, matching the
  // transform Next.js itself applies.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(__dirname, "tests/stubs/server-only.ts") },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "$1") },
    ],
  },
});
