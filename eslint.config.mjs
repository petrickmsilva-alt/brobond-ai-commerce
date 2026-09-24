import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
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
    // PR007 — AI Personalization Engine.
    //
    // `modules/ai/openai/client.ts` (the OpenAI Responses API client) and
    // `modules/ai/openai/generator.ts` (which calls it) must run
    // server-side only — the API key must never reach a browser bundle.
    // Both already import `server-only`, which fails the Next.js *build*
    // if pulled into a Client Component's module graph. This rule adds a
    // second, faster line of defense at `next lint` time: Client
    // Components (everything under `components/**`) are forbidden from
    // importing either module directly — even transitively via a
    // re-export — so the mistake is caught before a build is attempted.
    // (`modules/ai/openai/prompts.ts` holds no secret and no network call —
    // it's plain data/types safely shared with the UI — so it is exempt.)
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
];

export default eslintConfig;
