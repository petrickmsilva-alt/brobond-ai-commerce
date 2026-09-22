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
  },
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(__dirname, "tests/stubs/server-only.ts") },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "$1") },
    ],
  },
});
