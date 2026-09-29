import { beforeEach, describe, expect, it, vi } from "vitest";

const checkDatabaseHealthMock = vi.hoisted(() => vi.fn());
const getPrismaMock = vi.hoisted(() => vi.fn(() => ({ $queryRaw: vi.fn() })));
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/database-health", () => ({ checkDatabaseHealth: checkDatabaseHealthMock }));
vi.mock("@/lib/prisma", () => ({ getPrisma: getPrismaMock }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: reportErrorMock }));

const { GET } = await import("@/app/api/health/database/route");

beforeEach(() => {
  checkDatabaseHealthMock.mockReset();
  getPrismaMock.mockClear();
  reportErrorMock.mockReset();
});

describe("GET /api/health/database", () => {
  it("resolves Prisma only when the request arrives and returns the healthy contract", async () => {
    expect(getPrismaMock).not.toHaveBeenCalled();
    checkDatabaseHealthMock.mockResolvedValue({});

    const response = await GET(new Request("http://localhost/api/health/database"));

    expect(getPrismaMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok", database: "connected" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a sanitized PRISMA_UNAVAILABLE response with HTTP 503", async () => {
    checkDatabaseHealthMock.mockRejectedValue(
      new Error("connect ECONNREFUSED postgresql://secret@database.internal/brobond"),
    );

    const response = await GET(
      new Request("http://localhost/api/health/database", {
        headers: { "x-request-id": "request-123", "x-correlation-id": "correlation-123" },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "PRISMA_UNAVAILABLE",
      requestId: "request-123",
    });
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        requestId: "request-123",
        correlationId: "correlation-123",
      }),
    );
  });

  it("sanitizes a missing DATABASE_URL initialization failure", async () => {
    getPrismaMock.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to initialize Prisma.");
    });

    const response = await GET(new Request("http://localhost/api/health/database"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      code: "PRISMA_UNAVAILABLE",
    });
    expect(checkDatabaseHealthMock).not.toHaveBeenCalled();
  });

  it("returns ENV_INVALID before resolving Prisma when the runtime auth contract is incomplete", async () => {
    const original = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;

    try {
      const response = await GET(new Request("http://localhost/api/health/database"));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: "error",
        code: "ENV_INVALID",
      });
      expect(getPrismaMock).not.toHaveBeenCalled();
    } finally {
      process.env.AUTH_SECRET = original;
    }
  });
});
