/**
 * AI Personalization Engine — public surface (PR007, PR007.1).
 *
 * modules/ai/
 * ├── openai/           Responses API client, versioned prompts, generator
 * ├── personalization/  context builder + cache-aware orchestration service
 * ├── audit/            context snapshot diff (PR007.1, pure, server+client safe)
 * ├── repositories/      tenant-scoped Prisma data access (server-only)
 * └── validators/        Zod schemas for server actions
 *
 * SECURITY: `openai/client.ts` and `openai/generator.ts` are `server-only`
 * and MUST NEVER be imported by a Client Component — see
 * `eslint.config.mjs`'s `no-restricted-imports` rule, which fails the build
 * if a `"use client"` file imports anything under `modules/ai/openai/`.
 */
export * from "./openai/prompts";
export * from "./personalization/context-builder";
export * from "./audit/context-diff";
export * from "./validators/generate-message.validator";
