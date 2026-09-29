import { describe, expect, it, vi } from "vitest";
import { checkDatabaseHealth, REQUIRED_DATABASE_MIGRATION } from "@/lib/database-health";

function healthyDatabase() {
  return {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ database: 1 }])
      .mockResolvedValueOnce([{ migration_name: REQUIRED_DATABASE_MIGRATION }])
      .mockResolvedValueOnce([
        {
          organization_table: true,
          user_table: true,
          workspace_name_column: true,
          password_hash_column: true,
        },
      ]),
  };
}

describe("checkDatabaseHealth()", () => {
  it("reports Prisma, database, migrations and measured latency", async () => {
    const db = healthyDatabase();
    let time = 100;

    await expect(
      checkDatabaseHealth(db as never, {
        now: () => time++,
      }),
    ).resolves.toEqual({
      prisma: true,
      database: true,
      migrations: true,
      latency: 1,
    });
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("returns PRISMA_UNAVAILABLE with the driver diagnostic when Prisma is offline", async () => {
    const db = {
      $queryRaw: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432")),
    };

    await expect(checkDatabaseHealth(db as never)).rejects.toMatchObject({
      code: "PRISMA_UNAVAILABLE",
      message: "Banco de dados indisponível.",
      details: expect.stringContaining("ECONNREFUSED"),
      status: { prisma: true, database: false, migrations: false },
    });
  });

  it("returns DATABASE_TIMEOUT instead of hanging when the database does not answer", async () => {
    const db = {
      $queryRaw: vi.fn(() => new Promise<never>(() => undefined)),
    };

    await expect(checkDatabaseHealth(db as never, { timeoutMs: 5 })).rejects.toMatchObject({
      code: "DATABASE_TIMEOUT",
      message: "Tempo limite do banco excedido.",
      details: expect.stringMatching(/conexão.*tempo limite/i),
    });
  });

  it("returns MIGRATION_PENDING when the required migration is absent", async () => {
    const db = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ database: 1 }])
        .mockResolvedValueOnce([]),
    };

    await expect(checkDatabaseHealth(db as never)).rejects.toMatchObject({
      code: "MIGRATION_PENDING",
      details: expect.stringContaining(REQUIRED_DATABASE_MIGRATION),
      status: { prisma: true, database: true, migrations: false },
    });
  });

  it("returns SCHEMA_INVALID when a required column is absent", async () => {
    const db = healthyDatabase();
    db.$queryRaw.mockReset();
    db.$queryRaw
      .mockResolvedValueOnce([{ database: 1 }])
      .mockResolvedValueOnce([{ migration_name: REQUIRED_DATABASE_MIGRATION }])
      .mockResolvedValueOnce([
        {
          organization_table: true,
          user_table: true,
          workspace_name_column: false,
          password_hash_column: true,
        },
      ]);

    await expect(checkDatabaseHealth(db as never)).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
      details: expect.stringContaining("Organization.workspaceName"),
      status: { prisma: true, database: true, migrations: true },
    });
  });
});
