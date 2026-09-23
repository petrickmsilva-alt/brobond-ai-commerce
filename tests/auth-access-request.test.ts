import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR010.2 §5 — public "Solicitar acesso" queue.
 *
 * The invariant worth defending: an access request is a LEAD, never an
 * account. It carries no password, no role and no tenant, approving one
 * provisions nothing, and repeated submissions cannot flood the ADMIN queue.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { createAccessRequestService } = await import("@/modules/auth/access-request.service");

type Row = Record<string, unknown>;

function makeDb() {
  const rows: Row[] = [];
  let sequence = 0;

  function matches(row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => row[key] === value);
  }

  const db = {
    accessRequest: {
      findFirst: vi.fn(async ({ where }: { where?: Row }) => {
        return rows.find((row) => matches(row, where)) ?? null;
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        return rows.find((row) => matches(row, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where, take }: { where?: Row; take?: number }) => {
        const found = rows.filter((row) => matches(row, where));
        return take ? found.slice(0, take) : found;
      }),
      count: vi.fn(async ({ where }: { where?: Row } = {}) => {
        return rows.filter((row) => matches(row, where)).length;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        sequence += 1;
        const row = {
          id: `req_${sequence}`,
          reviewNote: null,
          reviewedAt: null,
          reviewedBy: null,
          createdAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = rows.find((item) => matches(item, where));
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
    },
  };

  return { db, rows };
}

const PAYLOAD = {
  name: "Ana Souza",
  company: "Brobond Retail",
  email: "ana@retail.com.br",
  whatsapp: "+55 11 99999-0000",
  message: "Gostaria de conhecer a plataforma.",
};

let fake: ReturnType<typeof makeDb>;
let service: ReturnType<typeof createAccessRequestService>;

beforeEach(() => {
  fake = makeDb();
  service = createAccessRequestService(fake.db as never);
});

describe("submit()", () => {
  it("persists the request as PENDING", async () => {
    const result = await service.submit(PAYLOAD);

    expect(result.status).toBe("PENDING");
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({
      name: "Ana Souza",
      company: "Brobond Retail",
      email: "ana@retail.com.br",
      status: "PENDING",
    });
  });

  it("keeps every field the form collects", async () => {
    const result = await service.submit(PAYLOAD);
    expect(result.whatsapp).toBe("+55 11 99999-0000");
    expect(result.message).toBe("Gostaria de conhecer a plataforma.");
  });

  it("accepts an optional whatsapp and message as null", async () => {
    const result = await service.submit({ ...PAYLOAD, whatsapp: null, message: null });
    expect(result.whatsapp).toBeNull();
    expect(result.message).toBeNull();
  });

  it("NEVER writes a role, tenant or password — it is a lead, not an account", async () => {
    await service.submit(PAYLOAD);
    const stored = fake.rows[0] as Row;

    expect(stored).not.toHaveProperty("role");
    expect(stored).not.toHaveProperty("organizationId");
    expect(stored).not.toHaveProperty("passwordHash");
  });

  it("is idempotent per pending email — a flood yields ONE row", async () => {
    await service.submit(PAYLOAD);
    await service.submit(PAYLOAD);
    await service.submit(PAYLOAD);
    await service.submit(PAYLOAD);
    await service.submit(PAYLOAD);

    expect(fake.rows).toHaveLength(1);
  });

  it("refreshes the pending row with the latest details", async () => {
    await service.submit(PAYLOAD);
    const second = await service.submit({ ...PAYLOAD, company: "Brobond Atacado" });

    expect(fake.rows).toHaveLength(1);
    expect(second.company).toBe("Brobond Atacado");
  });

  it("queues a genuinely different email separately", async () => {
    await service.submit(PAYLOAD);
    await service.submit({ ...PAYLOAD, email: "bruno@outra.com.br" });
    expect(fake.rows).toHaveLength(2);
  });

  it("queues a NEW request once the previous one was reviewed", async () => {
    const first = await service.submit(PAYLOAD);
    await service.review(first.id, "REJECTED", "user_admin");

    await service.submit(PAYLOAD);
    expect(fake.rows).toHaveLength(2);
  });
});

describe("list()", () => {
  beforeEach(async () => {
    await service.submit(PAYLOAD);
    await service.submit({ ...PAYLOAD, email: "b@x.com" });
    await service.submit({ ...PAYLOAD, email: "c@x.com" });
  });

  it("returns the queue", async () => {
    expect(await service.list()).toHaveLength(3);
  });

  it("filters by status", async () => {
    const [first] = fake.rows;
    await service.review(first?.id as string, "APPROVED", "user_admin");

    expect(await service.list({ status: "APPROVED" })).toHaveLength(1);
    expect(await service.list({ status: "PENDING" })).toHaveLength(2);
  });

  it("honours `take`", async () => {
    expect(await service.list({ take: 2 })).toHaveLength(2);
  });

  it("exposes no internal reviewer id in the view", async () => {
    const [view] = await service.list();
    expect(view).not.toHaveProperty("reviewedBy");
  });
});

describe("counts()", () => {
  it("is all zeroes on an empty queue", async () => {
    await expect(service.counts()).resolves.toEqual({
      pending: 0,
      approved: 0,
      rejected: 0,
      total: 0,
    });
  });

  it("tallies each status", async () => {
    const a = await service.submit(PAYLOAD);
    const b = await service.submit({ ...PAYLOAD, email: "b@x.com" });
    await service.submit({ ...PAYLOAD, email: "c@x.com" });

    await service.review(a.id, "APPROVED", "user_admin");
    await service.review(b.id, "REJECTED", "user_admin");

    await expect(service.counts()).resolves.toEqual({
      pending: 1,
      approved: 1,
      rejected: 1,
      total: 3,
    });
  });
});

describe("review()", () => {
  it("records an APPROVED decision with reviewer and timestamp", async () => {
    const request = await service.submit(PAYLOAD);
    const now = new Date("2026-09-23T12:00:00.000Z");

    const reviewed = await service.review(request.id, "APPROVED", "user_admin", "Cliente OK", now);

    expect(reviewed?.status).toBe("APPROVED");
    expect(reviewed?.reviewNote).toBe("Cliente OK");
    expect(reviewed?.reviewedAt).toEqual(now);
    expect(fake.rows[0]?.reviewedBy).toBe("user_admin");
  });

  it("records a REJECTED decision", async () => {
    const request = await service.submit(PAYLOAD);
    const reviewed = await service.review(request.id, "REJECTED", "user_admin");
    expect(reviewed?.status).toBe("REJECTED");
  });

  it("APPROVING PROVISIONS NOTHING — no user, no invitation, no token", async () => {
    // §5/§11: approval clears the lead; a separate, explicit invitation is the
    // only way to create an account. This is the guard against a stray click
    // granting workspace access.
    const request = await service.submit(PAYLOAD);
    await service.review(request.id, "APPROVED", "user_admin");

    expect(Object.keys(fake.db)).toEqual(["accessRequest"]);
    expect(fake.rows[0]).not.toHaveProperty("passwordHash");
    expect(fake.rows[0]).not.toHaveProperty("organizationId");
  });

  it("returns null for an unknown id instead of throwing", async () => {
    await expect(service.review("missing", "APPROVED", "user_admin")).resolves.toBeNull();
  });

  it("allows a decision to be corrected", async () => {
    const request = await service.submit(PAYLOAD);
    await service.review(request.id, "REJECTED", "user_admin");
    const corrected = await service.review(request.id, "APPROVED", "user_admin_2");

    expect(corrected?.status).toBe("APPROVED");
    expect(fake.rows[0]?.reviewedBy).toBe("user_admin_2");
  });
});
