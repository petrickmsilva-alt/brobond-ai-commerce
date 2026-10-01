import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PR016 — serializable icon contract for `TableEmptyState`.
 *
 * The isolated connector screens (`/dashboard/connectors/[provider]`) crashed
 * with the global error screen because a Server Component passed lucide
 * icons — function references — as the `icon` prop of `TableEmptyState`, a
 * Client Component: React can never serialize a function across the
 * server→client boundary ("Functions cannot be passed directly to Client
 * Components").
 *
 * These are source-level contracts, not rendering tests (same style as
 * `signup-ui-contracts.test.ts`): the promise is structural — the
 * function-valued prop no longer exists, identifiers are plain strings
 * resolved INSIDE the client, and the connector screen only ever passes
 * strings. A refactor that silently reintroduces the crash vector fails
 * here (and, because the prop type is a literal union, at compile time).
 */

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const tableEmptyState = read("components/ui/table-empty-state.tsx");
const providerPage = read("app/dashboard/connectors/[provider]/page.tsx");

describe("TableEmptyState — serializable icon contract", () => {
  it("is a Client Component (reads useSearchParams)", () => {
    expect(tableEmptyState.startsWith('"use client"')).toBe(true);
  });

  it("no longer declares the function-valued `icon` prop (the crash vector)", () => {
    expect(tableEmptyState).not.toContain("icon?: LucideIcon");
    // The destructured parameter list takes `iconName`, never `icon`.
    expect(tableEmptyState).not.toMatch(/^\s{2}icon,$/m);
  });

  it("declares the string identifier prop instead", () => {
    expect(tableEmptyState).toMatch(/iconName\?: TableEmptyStateIconName/);
    expect(tableEmptyState).toMatch(/export type TableEmptyStateIconName = keyof typeof ICONS/);
  });

  it("resolves the icons from a registry INSIDE the client component", () => {
    expect(tableEmptyState).toMatch(/const ICONS = \{/);
    expect(tableEmptyState).toMatch(/iconName \? ICONS\[iconName\] : undefined/);
  });

  it("the registry is type-checked against LucideIcon (satisfies)", () => {
    expect(tableEmptyState).toMatch(/as const satisfies Record<string, LucideIcon>/);
  });

  it("exposes every identifier the screens rely on", () => {
    for (const name of ["inbox:", "wallet:", "users:", "package:"]) {
      expect(tableEmptyState).toContain(`  ${name}`);
    }
  });
});

describe("connector detail screen — only strings cross the boundary", () => {
  it("is a Server Component", () => {
    expect(providerPage.startsWith('"use client"')).toBe(false);
  });

  it("passes the serializable identifiers to its empty states", () => {
    expect(providerPage).toMatch(/<TableEmptyState\s+iconName="wallet"/);
    expect(providerPage).toMatch(/<TableEmptyState\s+iconName="inbox"/);
  });

  it("never passes a lucide component to TableEmptyState", () => {
    // `icon={` remains legitimate for the SERVER-side KpiCard on this page;
    // the contract is that the CLIENT-boundary empty state never receives it.
    const emptyStateUsages = providerPage.match(/<TableEmptyState[\s\S]{0,400}?>/g) ?? [];
    expect(emptyStateUsages.length).toBeGreaterThanOrEqual(2);
    for (const usage of emptyStateUsages) {
      expect(usage).not.toMatch(/icon=\{/);
    }
  });
});
