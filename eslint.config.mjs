import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

export default defineConfig(
  ...nextCoreWebVitals,
  ...nextTypeScript,
  prettier,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "lib/generated/**",
    ],
  },
  {
    rules: {
      // Preserve the existing lint contract while adopting Next 16's native
      // flat config; these rules are newly enabled by the upgraded preset.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/modules/ai/openai/client",
                "@/modules/ai/openai/client",
                "**/modules/ai/openai/generator",
                "@/modules/ai/openai/generator",
              ],
              message:
                "The OpenAI Responses API client/generator may only be used from audited " +
                "server-only modules (modules/ai or modules/ai-ceo). It must never be " +
                "imported by a Client Component.",
            },
          ],
        },
      ],
    },
  },
);
