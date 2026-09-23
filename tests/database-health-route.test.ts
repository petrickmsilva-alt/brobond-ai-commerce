import { beforeEach, describe, expect, it, vi } from "vitest";

const checkDatabaseHealthMock = vi.hoisted(() => vi.fn());
const getEnvMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/database-health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/database-health")>();
  return { ...actual, checkDatabaseHealth: checkDatabaseHealthMock };
});
vi.mock("@/lib/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn() } }));

const { DatabaseHealthError } = await import("@/lib/database-health");
const { GET } = await import("@/app/api/health/database/route");

beforeEach(() => {
  checkDatabaseHealthMock.mockReset();
  getEnvMock.mockReset().mockReturnValue({});
});

describe("GET /api/health/database", () => {
  it("returns the exact healthy contract", async () => {
    checkDatabaseHealthMock.mockResolvedValue({
      prisma: true,
      database: true,
      migrations: true,
      latency: 12,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      prisma: true,
      database: true,
      migrations: true,
      latency: 12,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a specific database failure with HTTP 503", async () => {
    checkDatabaseHealthMock.mockRejectedValue(
      new DatabaseHealthError("PRISMA_UNAVAILABLE", "Banco de dados indisponível.", {
        details: "SELECT 1: connect ECONNREFUSED",
        status: { prisma: true, database: false, migrations: false },
        latency: 9,
      }),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      prisma: true,
      database: false,
      migrations: false,
      latency: 9,
      error: {
        code: "PRISMA_UNAVAILABLE",
        message: "Banco de dados indisponível.",
        details: "SELECT 1: connect ECONNREFUSED",
      },
    });
  });

  it("diagnoses a missing startup variable before loading Prisma", async () => {
    getEnvMock.mockImplementation(() => {
      throw new Error("Invalid environment variables: DATABASE_URL is required");
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      prisma: false,
      database: false,
      migrations: false,
      error: {
        code: "ENV_INVALID",
        details: expect.stringContaining("DATABASE_URL"),
      },
    });
    expect(checkDatabaseHealthMock).not.toHaveBeenCalled();
  });
});
