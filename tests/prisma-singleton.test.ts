import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(async () => {
  process.env.DATABASE_URL = originalDatabaseUrl;
  const holder = globalThis as typeof globalThis & {
    __brobondPrisma?: { $disconnect(): Promise<void> };
  };
  if (holder.__brobondPrisma) await holder.__brobondPrisma.$disconnect();
  delete holder.__brobondPrisma;
  vi.resetModules();
});

describe("lazy Prisma singleton", () => {
  it("can import lib/prisma without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();

    await expect(import("@/lib/prisma")).resolves.toMatchObject({
      getPrisma: expect.any(Function),
      prisma: expect.any(Object),
    });
  });

  it("throws only when getPrisma is called without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { getPrisma } = await import("@/lib/prisma");

    expect(getPrisma).toThrow("DATABASE_URL is required to initialize Prisma.");
  });

  it("creates once and reuses the process-wide client", async () => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    const firstModule = await import("@/lib/prisma");
    const first = firstModule.getPrisma();

    vi.resetModules();
    const second = (await import("@/lib/prisma")).getPrisma();

    expect(second).toBe(first);
  });
});
