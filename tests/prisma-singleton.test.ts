import { describe, expect, it, vi } from "vitest";

describe("Prisma singleton", () => {
  it("reuses the same global client even when the module cache is rebuilt", async () => {
    const first = (await import("@/lib/prisma")).prisma;

    vi.resetModules();
    const second = (await import("@/lib/prisma")).prisma;

    expect(second).toBe(first);
  });
});
