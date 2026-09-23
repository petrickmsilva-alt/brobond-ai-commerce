import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken, passwordResetExpiry } from "@/lib/tokens";

/**
 * PR010.2 §6 — password reset (email → token → nova senha, 30-minute TTL).
 *
 * Tested against an in-memory fake Prisma through the same
 * `createPasswordResetService(db)` factory production uses. The contracts that
 * matter here are security ones:
 *
 *   1. NO USER ENUMERATION — an unknown email is indistinguishable;
 *   2. only the token DIGEST is persisted;
 *   3. the token expires in exactly 30 minutes;
 *   4. single use — a replay cannot rewrite the password twice;
 *   5. issuing a new token kills every outstanding one.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async (plain: string) => `hashed:${plain}`),
}));

const { createPasswordResetService, PasswordResetError } =
  await import("@/modules/auth/password-reset.service");

type Row = Record<string, unknown>;

function makeDb() {
  const tokens: Row[] = [];
  const users: Row[] = [{ id: "user_1", email: "ana@brobond.ai", passwordHash: "hashed:old" }];
  let sequence = 0;

  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === null) return row[key] === null || row[key] === undefined;
      return row[key] === value;
    });
  }

  const db = {
    passwordResetToken: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        return tokens.find((row) => matches(row, where)) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        sequence += 1;
        const row = { id: `tok_${sequence}`, usedAt: null, createdAt: new Date(), ...data };
        tokens.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = tokens.filter((row) => matches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const keep = tokens.filter((row) => !matches(row, where));
        const removed = tokens.length - keep.length;
        tokens.splice(0, tokens.length, ...keep);
        return { count: removed };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        return users.find((row) => matches(row, where)) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = users.find((item) => matches(item, where));
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };

  return { db, tokens, users };
}

let fake: ReturnType<typeof makeDb>;
let service: ReturnType<typeof createPasswordResetService>;

beforeEach(() => {
  fake = makeDb();
  service = createPasswordResetService(fake.db as never);
});

describe("request() — no user enumeration", () => {
  it("issues a token for a known email", async () => {
    const result = await service.request("ana@brobond.ai");
    expect(result.token).toBeTruthy();
    expect(fake.tokens).toHaveLength(1);
  });

  it("returns the SAME SHAPE for an unknown email, with no token", async () => {
    const known = await service.request("ana@brobond.ai");
    const unknown = await service.request("ghost@brobond.ai");

    // Identical key sets — a caller cannot tell the two apart structurally.
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort());
    expect(unknown.token).toBeNull();
  });

  it("writes NOTHING for an unknown email", async () => {
    await service.request("ghost@brobond.ai");
    expect(fake.tokens).toHaveLength(0);
    expect(fake.db.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("never throws for an unknown email", async () => {
    await expect(service.request("ghost@brobond.ai")).resolves.toBeDefined();
  });

  it("normalizes the email before lookup", async () => {
    const result = await service.request("  Ana@Brobond.AI  ");
    expect(result.token).toBeTruthy();
    expect(result.email).toBe("ana@brobond.ai");
  });
});

describe("request() — token storage", () => {
  it("stores ONLY the digest, never the raw token", async () => {
    const { token } = await service.request("ana@brobond.ai");

    const stored = fake.tokens[0] as Row;
    expect(stored.tokenHash).toBe(hashToken(token as string));
    expect(JSON.stringify(stored)).not.toContain(token as string);
  });

  it("sets a 30-minute expiry", async () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    await service.request("ana@brobond.ai", now);

    expect((fake.tokens[0]?.expiresAt as Date).toISOString()).toBe(
      passwordResetExpiry(now).toISOString(),
    );
    expect((fake.tokens[0]?.expiresAt as Date).toISOString()).toBe("2026-09-23T12:30:00.000Z");
  });

  it("invalidates every outstanding token when a new one is issued", async () => {
    const first = await service.request("ana@brobond.ai");
    const second = await service.request("ana@brobond.ai");

    expect(fake.tokens).toHaveLength(1);
    expect(fake.tokens[0]?.tokenHash).toBe(hashToken(second.token as string));

    // The earlier link is dead.
    await expect(service.isValid(first.token as string)).resolves.toBe(false);
  });

  it("issues a distinct token every time", async () => {
    const a = await service.request("ana@brobond.ai");
    const b = await service.request("ana@brobond.ai");
    expect(a.token).not.toBe(b.token);
  });
});

describe("resolveToken() / isValid()", () => {
  it("accepts a live token", async () => {
    const { token } = await service.request("ana@brobond.ai");
    await expect(service.isValid(token as string)).resolves.toBe(true);
  });

  it("rejects an unknown token", async () => {
    await expect(service.resolveToken("made-up")).rejects.toMatchObject({ reason: "not_found" });
    await expect(service.isValid("made-up")).resolves.toBe(false);
  });

  it("rejects the token one second AFTER the 30-minute TTL", async () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    const { token } = await service.request("ana@brobond.ai", now);

    await expect(
      service.resolveToken(token as string, new Date("2026-09-23T12:30:01.000Z")),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("still accepts the token one second BEFORE expiry", async () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    const { token } = await service.request("ana@brobond.ai", now);

    await expect(
      service.isValid(token as string, new Date("2026-09-23T12:29:59.000Z")),
    ).resolves.toBe(true);
  });

  it("rejects a token that has already been used", async () => {
    const { token } = await service.request("ana@brobond.ai");
    await service.consume(token as string, "brand-new-pass-1");

    // The row is retained and stamped `usedAt`, so the service can report
    // `used` rather than a generic miss — the UI still shows one neutral
    // message, but the audit trail keeps the distinction.
    await expect(service.resolveToken(token as string)).rejects.toMatchObject({
      reason: "used",
    });
    await expect(service.isValid(token as string)).resolves.toBe(false);
  });
});

describe("consume()", () => {
  it("rewrites the user's password as a hash", async () => {
    const { token } = await service.request("ana@brobond.ai");
    await service.consume(token as string, "brand-new-pass-1");

    expect(fake.users[0]?.passwordHash).toBe("hashed:brand-new-pass-1");
  });

  it("never stores the plaintext password", async () => {
    const { token } = await service.request("ana@brobond.ai");
    await service.consume(token as string, "brand-new-pass-1");

    expect(JSON.stringify(fake.users)).not.toContain('"brand-new-pass-1"');
  });

  it("returns the account it just updated", async () => {
    const { token } = await service.request("ana@brobond.ai");
    await expect(service.consume(token as string, "brand-new-pass-1")).resolves.toMatchObject({
      userId: "user_1",
      email: "ana@brobond.ai",
    });
  });

  it("is SINGLE USE — a replay is refused", async () => {
    const { token } = await service.request("ana@brobond.ai");
    await service.consume(token as string, "brand-new-pass-1");

    await expect(service.consume(token as string, "attacker-pass-9")).rejects.toBeInstanceOf(
      PasswordResetError,
    );
    // The attacker's password was never applied.
    expect(fake.users[0]?.passwordHash).toBe("hashed:brand-new-pass-1");
  });

  it("refuses an expired token and leaves the password untouched", async () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    const { token } = await service.request("ana@brobond.ai", now);

    await expect(
      service.consume(token as string, "too-late-pass-1", new Date("2026-09-23T13:00:00.000Z")),
    ).rejects.toMatchObject({ reason: "expired" });

    expect(fake.users[0]?.passwordHash).toBe("hashed:old");
  });

  it("clears sibling tokens so no second link survives the reset", async () => {
    const { token } = await service.request("ana@brobond.ai");
    await service.consume(token as string, "brand-new-pass-1");

    const live = fake.tokens.filter((row) => row.usedAt === null);
    expect(live).toHaveLength(0);
  });
});
