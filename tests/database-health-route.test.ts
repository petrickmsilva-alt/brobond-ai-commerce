import { beforeEach, describe, expect, it, vi } from "vitest";

const checkDatabaseHealthMock = vi.hoisted(() => vi.fn());
const getPrismaMock = vi.hoisted(() => vi.fn(() => ({ $queryRaw: vi.fn() })));

vi.mock("@/lib/database-health", () => ({ checkDatabaseHealth: checkDatabaseHealthMock }));
vi.mock("@/lib/prisma", () => ({ getPrisma: getPrismaMock }));

const { GET } = await import("@/app/api/health/database/route");

beforeEach(() => {
  checkDatabaseHealthMock.mockReset();
  getPrismaMock.mockClear();
});

describe("GET /api/health/database", () => {
  it("resolves Prisma only when the request arrives and returns the healthy contract", async () => {
    expect(getPrismaMock).not.toHaveBeenCalled();
    checkDatabaseHealthMock.mockResolvedValue({});

    const response = await GET();

    expect(getPrismaMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", database: "connected" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a sanitized PRISMA_UNAVAILABLE response with HTTP 503", async () => {
    checkDatabaseHealthMock.mockRejectedValue(
      new Error("connect ECONNREFUSED postgresql://secret@database.internal/brobond"),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "PRISMA_UNAVAILABLE",
    });
  });

  it("sanitizes a missing DATABASE_URL initialization failure", async () => {
    getPrismaMock.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to initialize Prisma.");
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "PRISMA_UNAVAILABLE",
    });
    expect(checkDatabaseHealthMock).not.toHaveBeenCalled();
  });
});
