import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { SELF_SIGNUP_MIGRATION, SignupReadinessError, assertSignupReady } =
  await import("@/modules/auth/signup-health.service");

function readyDb() {
  return {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ connected: 1 }])
      .mockResolvedValueOnce([{ migration_name: SELF_SIGNUP_MIGRATION }])
      .mockResolvedValueOnce([{ organization: true, user: true }]),
  };
}

describe("assertSignupReady()", () => {
  it("checks Prisma connectivity, migration metadata, Organization and User in order", async () => {
    const db = readyDb();

    await expect(assertSignupReady(db as never)).resolves.toEqual({
      connected: true,
      migration: SELF_SIGNUP_MIGRATION,
      tables: { organization: true, user: true },
    });
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("returns PRISMA_UNAVAILABLE when the connection probe fails", async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) };

    await expect(assertSignupReady(db as never)).rejects.toMatchObject({
      code: "PRISMA_UNAVAILABLE",
      message: "Banco de dados indisponível.",
      details: expect.stringMatching(/Prisma.*ECONNREFUSED/i),
    });
  });

  it("returns MIGRATION_PENDING without writing anything when the signup migration is absent", async () => {
    const db = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ connected: 1 }])
        .mockResolvedValueOnce([]),
    };

    await expect(assertSignupReady(db as never)).rejects.toMatchObject({
      code: "MIGRATION_PENDING",
      details: expect.stringContaining(SELF_SIGNUP_MIGRATION),
    });
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("maps an unreadable _prisma_migrations table to MIGRATION_PENDING", async () => {
    const db = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ connected: 1 }])
        .mockRejectedValueOnce(new Error('relation "_prisma_migrations" does not exist')),
    };

    await expect(assertSignupReady(db as never)).rejects.toBeInstanceOf(SignupReadinessError);
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("returns only supported booleans from the Organization/User schema probe", async () => {
    const db = readyDb();

    await assertSignupReady(db as never);

    const template = db.$queryRaw.mock.calls[2]?.[0] as readonly string[] | undefined;
    const sql = template?.join("?") ?? "";
    expect(sql).toMatch(/to_regclass\([^)]*Organization[^)]*\)\s+IS NOT NULL/i);
    expect(sql).toMatch(/to_regclass\([^)]*User[^)]*\)\s+IS NOT NULL/i);
    expect(sql).not.toMatch(/to_regclass\([^)]*\)\s+AS\s+"(?:organization|user)"/i);
  });

  it("returns SCHEMA_INCOMPLETE when User or Organization does not exist", async () => {
    const db = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ connected: 1 }])
        .mockResolvedValueOnce([{ migration_name: SELF_SIGNUP_MIGRATION }])
        .mockResolvedValueOnce([{ organization: true, user: false }]),
    };

    await expect(assertSignupReady(db as never)).rejects.toMatchObject({
      code: "SCHEMA_INCOMPLETE",
      details: "Tabela(s) ausente(s): User.",
    });
  });
});
