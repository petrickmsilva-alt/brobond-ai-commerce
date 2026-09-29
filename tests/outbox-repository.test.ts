import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import { createOutboxRepository } from "@/modules/outreach/queue/outbox.repository";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

function fakeDb() {
  const rows: Array<Record<string, any>> = [];
  const matches = (row: Record<string, any>, where: Record<string, any>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === "status" && typeof value === "object" && value?.in)
        return value.in.includes(row.status);
      return row[key] === value;
    });
  const outreachMessage = {
    create: vi.fn(async ({ data }) => {
      const row = {
        id: `m${rows.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const selected = rows.filter((row) => matches(row, where));
      selected.forEach((row) => Object.assign(row, data));
      return { count: selected.length };
    }),
    findFirst: vi.fn(async ({ where }) => rows.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }) => rows.filter((row) => matches(row, where))),
    count: vi.fn(async ({ where }) => rows.filter((row) => matches(row, where)).length),
    groupBy: vi.fn(async ({ where }) => {
      const counts = new Map<string, number>();
      rows
        .filter((row) => matches(row, where))
        .forEach((row) => counts.set(row.status, (counts.get(row.status) ?? 0) + 1));
      return [...counts].map(([status, count]) => ({ status, _count: { _all: count } }));
    }),
  };
  return { db: { outreachMessage }, rows, outreachMessage };
}

const dto = {
  creatorId: "c",
  productId: "p",
  campaignId: "x",
  templateId: "t",
  generatedText: "Olá",
};

describe("Outbox repository", () => {
  let fake: ReturnType<typeof fakeDb>;
  let repository: ReturnType<typeof createOutboxRepository>;
  beforeEach(() => {
    fake = fakeDb();
    repository = createOutboxRepository(fake.db as never);
  });

  it("creates tenant-scoped DRAFT records", async () => {
    const row = await repository.createDraft("org_a", dto);
    expect(row).toMatchObject({ organizationId: "org_a", status: "DRAFT" });
  });
  it("does not trust a caller status", async () => {
    const row = await repository.createDraft("org_a", { ...dto, status: "SENT" } as never);
    expect(row.status).toBe("DRAFT");
  });
  it("schedules only within the caller tenant", async () => {
    const a = await repository.createDraft("org_a", dto);
    const b = await repository.createDraft("org_b", dto);
    const date = new Date(Date.now() + 60_000);
    await repository.scheduleMessage("org_a", b.id, date);
    expect(fake.rows.find((row) => row.id === b.id)?.status).toBe("DRAFT");
    await repository.scheduleMessage("org_a", a.id, date);
    expect(fake.rows.find((row) => row.id === a.id)?.status).toBe("SCHEDULED");
  });
  it("rejects scheduling in the past", async () => {
    const row = await repository.createDraft("org_a", dto);
    await expect(repository.scheduleMessage("org_a", row.id, new Date(0))).rejects.toThrow(
      RangeError,
    );
  });
  it("cancels DRAFT/READY/SCHEDULED and clears schedule", async () => {
    const row = await repository.createDraft("org_a", dto);
    await repository.cancelMessage("org_a", row.id);
    expect(fake.rows[0]).toMatchObject({ status: "CANCELLED", scheduledFor: null });
  });
  it("cannot cancel a sent message", async () => {
    const row = await repository.createDraft("org_a", dto);
    fake.rows[0]!.status = "SENT";
    await expect(repository.cancelMessage("org_a", row.id)).resolves.toBeNull();
  });
  it("lists only one tenant", async () => {
    await repository.createDraft("org_a", dto);
    await repository.createDraft("org_b", dto);
    expect((await repository.listOutbox("org_a")).total).toBe(1);
  });
  it("computes status KPIs per tenant", async () => {
    await repository.createDraft("org_a", dto);
    const sent = await repository.createDraft("org_a", dto);
    fake.rows.find((row) => row.id === sent.id)!.status = "SENT";
    await repository.createDraft("org_b", dto);
    await expect(repository.stats("org_a")).resolves.toMatchObject({
      DRAFT: 1,
      SENT: 1,
      FAILED: 0,
    });
  });
  it.each(["", "   "])("rejects blank tenant %j", async (organizationId) => {
    await expect(repository.createDraft(organizationId, dto)).rejects.toThrow(AuthorizationError);
    expect(fake.outreachMessage.create).not.toHaveBeenCalled();
  });
});
