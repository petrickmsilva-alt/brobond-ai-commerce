import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR011.1 — login brute-force protection tests.
 *
 * `lib/rate-limit.ts` backs the Credentials `authorize()` path with the
 * `RateLimit` table. Prisma is mocked with an in-memory table so the
 * policy logic is pinned without a database:
 *
 *   - 5 failed attempts inside a 15-minute sliding window lock the
 *     identifier for 15 minutes;
 *   - expired locks and stale windows reset instead of locking forever;
 *   - identifiers are normalized to lowercase on every path;
 *   - a successful login clears the counter.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = (args: any) => Promise<any>;

interface RateLimitRow {
  id: string;
  identifier: string;
  type: string;
  attempts: number;
  lockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const prismaMock = {
  rateLimit: {
    findUnique: vi.fn<AnyArgs>(async () => null),
    update: vi.fn<AnyArgs>(async () => undefined),
    upsert: vi.fn<AnyArgs>(async () => undefined),
    updateMany: vi.fn<AnyArgs>(async () => ({ count: 0 })),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { isRateLimited, recordFailedAttempt, resetFailedAttempts, RATE_LIMIT_POLICY } =
  await import("@/lib/rate-limit");

const EMAIL = "Admin@Example.com";
const KEY = EMAIL.toLowerCase();

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

describe("rate limit — PR011.1 login brute-force protection", () => {
  let rows: RateLimitRow[];

  function seedRow(overrides: Partial<RateLimitRow> & { identifier: string }): RateLimitRow {
    const row: RateLimitRow = {
      id: `rl_${overrides.identifier}`,
      type: "login",
      attempts: 0,
      lockedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    rows.push(row);
    return row;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    prismaMock.rateLimit.findUnique.mockImplementation(
      async ({ where }: { where: { identifier_type: { identifier: string } } }) =>
        rows.find((row) => row.identifier === where.identifier_type.identifier) ?? null,
    );
    prismaMock.rateLimit.update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { identifier_type: { identifier: string } };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((r) => r.identifier === where.identifier_type.identifier)!;
        if (typeof data.attempts === "number") row.attempts = data.attempts;
        if ("lockedAt" in data) row.lockedAt = data.lockedAt as Date | null;
        if (data.updatedAt instanceof Date) row.updatedAt = data.updatedAt;
        return row;
      },
    );
    prismaMock.rateLimit.upsert.mockImplementation(
      async ({
        where,
        create,
        update,
      }: {
        where: { identifier_type: { identifier: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = rows.find((r) => r.identifier === where.identifier_type.identifier);
        if (existing) {
          existing.attempts = update.attempts as number;
          existing.updatedAt = update.updatedAt as Date;
          return existing;
        }
        const row: RateLimitRow = {
          id: `rl_${rows.length}`,
          identifier: create.identifier as string,
          type: create.type as string,
          attempts: create.attempts as number,
          lockedAt: null,
          createdAt: new Date(),
          updatedAt: create.updatedAt as Date,
        };
        rows.push(row);
        return row;
      },
    );
    prismaMock.rateLimit.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { identifier: string; type: string };
        data: Record<string, unknown>;
      }) => {
        const targets = rows.filter(
          (row) => row.identifier === where.identifier && row.type === where.type,
        );
        for (const target of targets) {
          target.attempts = data.attempts as number;
          target.lockedAt = data.lockedAt as Date | null;
          target.updatedAt = data.updatedAt as Date;
        }
        return { count: targets.length };
      },
    );
  });

  it("exposes the lockout policy (5 attempts · 15-min window · 15-min lock)", () => {
    expect(RATE_LIMIT_POLICY).toEqual({
      maxAttempts: 5,
      lockWindowMinutes: 15,
      lockDurationMinutes: 15,
    });
  });

  it("is not limited when the identifier has no record", async () => {
    await expect(isRateLimited(EMAIL)).resolves.toBe(false);
    expect(prismaMock.rateLimit.findUnique).toHaveBeenCalledWith({
      where: { identifier_type: { identifier: KEY, type: "login" } },
    });
  });

  it("is limited while the lock is active", async () => {
    seedRow({ identifier: KEY, attempts: 5, lockedAt: minutesAgo(1) });
    await expect(isRateLimited(EMAIL)).resolves.toBe(true);
  });

  it("resets and unlocks when the lock has expired", async () => {
    const row = seedRow({ identifier: KEY, attempts: 5, lockedAt: minutesAgo(16) });
    await expect(isRateLimited(EMAIL)).resolves.toBe(false);
    expect(row.attempts).toBe(0);
    expect(row.lockedAt).toBeNull();
    expect(prismaMock.rateLimit.update).toHaveBeenCalledTimes(1);
  });

  it("resets the attempt counter when the sliding window has gone stale", async () => {
    const row = seedRow({
      identifier: KEY,
      attempts: 4,
      lockedAt: null,
      updatedAt: minutesAgo(20),
    });
    await expect(isRateLimited(EMAIL)).resolves.toBe(false);
    expect(row.attempts).toBe(0);
    expect(prismaMock.rateLimit.update).toHaveBeenCalledTimes(1);
  });

  it("is limited once attempts reach the threshold even without a lock", async () => {
    seedRow({ identifier: KEY, attempts: 5, lockedAt: null });
    await expect(isRateLimited(EMAIL)).resolves.toBe(true);
  });

  it("is not limited below the attempt threshold inside the window", async () => {
    seedRow({ identifier: KEY, attempts: RATE_LIMIT_POLICY.maxAttempts - 1, lockedAt: null });
    await expect(isRateLimited(EMAIL)).resolves.toBe(false);
  });

  it("creates a first failed attempt via upsert (identifier lowercased)", async () => {
    await recordFailedAttempt(EMAIL);
    expect(prismaMock.rateLimit.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.rateLimit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { identifier_type: { identifier: KEY, type: "login" } },
        create: expect.objectContaining({ identifier: KEY, attempts: 1 }),
      }),
    );
  });

  it("restarts at one attempt when the window has gone stale", async () => {
    seedRow({ identifier: KEY, attempts: 4, updatedAt: minutesAgo(20) });
    await recordFailedAttempt(EMAIL);
    expect(prismaMock.rateLimit.upsert).toHaveBeenCalledTimes(1);
    const row = rows.find((r) => r.identifier === KEY)!;
    expect(row.attempts).toBe(1);
    expect(row.lockedAt).toBeNull();
  });

  it("increments attempts inside the window and locks at the threshold", async () => {
    const row = seedRow({ identifier: KEY, attempts: 4 });
    await recordFailedAttempt(EMAIL);
    expect(prismaMock.rateLimit.update).toHaveBeenCalledTimes(1);
    expect(row.attempts).toBe(5);
    expect(row.lockedAt).toBeInstanceOf(Date);
  });

  it("keeps lockedAt null while below the threshold", async () => {
    const row = seedRow({ identifier: KEY, attempts: 2 });
    await recordFailedAttempt(EMAIL);
    expect(row.attempts).toBe(3);
    expect(row.lockedAt).toBeNull();
  });

  it("resetFailedAttempts clears attempts and locks (successful login)", async () => {
    const row = seedRow({ identifier: KEY, attempts: 5, lockedAt: minutesAgo(1) });
    await resetFailedAttempts(EMAIL);
    expect(prismaMock.rateLimit.updateMany).toHaveBeenCalledWith({
      where: { identifier: KEY, type: "login" },
      data: { attempts: 0, lockedAt: null, updatedAt: expect.any(Date) },
    });
    expect(row.attempts).toBe(0);
    expect(row.lockedAt).toBeNull();
  });
});
