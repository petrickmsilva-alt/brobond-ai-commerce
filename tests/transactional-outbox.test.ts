import { describe, expect, it, vi } from "vitest";
import { createTransactionalOutboxRepository } from "@/modules/async-outbox/outbox.repository";

function fakeDatabase() {
  const rows: Array<Record<string, unknown>> = [];
  const outboxEvent = {
    upsert: vi.fn(async ({ where, create }) => {
      const existing = rows.find(
        (row) =>
          row.organizationId === where.organizationId_idempotencyKey.organizationId &&
          row.idempotencyKey === where.organizationId_idempotencyKey.idempotencyKey,
      );
      if (existing) return existing;
      const row = { id: `event_${rows.length + 1}`, status: "PENDING", attempts: 0, ...create };
      rows.push(row);
      return row;
    }),
    findFirst: vi.fn(async () => rows.find((row) => row.status === "PENDING") ?? null),
    updateMany: vi.fn(async ({ where, data }) => {
      const row = rows.find(
        (candidate) => candidate.id === where.id && candidate.status === "PENDING",
      );
      if (!row) return { count: 0 };
      Object.assign(row, data, {
        attempts: Number(row.attempts) + (data.attempts?.increment ?? 0),
      });
      return { count: 1 };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }) => rows.find((row) => row.id === where.id)),
  };
  return { rows, db: { outboxEvent }, outboxEvent };
}

describe("transactional outbox repository", () => {
  it("deduplicates events per tenant inside a supplied transaction", async () => {
    const fake = fakeDatabase();
    const repository = createTransactionalOutboxRepository(fake.db as never);
    const tx = { outboxEvent: fake.outboxEvent };
    const event = {
      topic: "message.ready",
      aggregateType: "OutreachMessage",
      aggregateId: "message_1",
      payload: { id: "message_1" },
      idempotencyKey: "message_1:ready",
    };
    await repository.create(tx as never, "org_a", event);
    await repository.create(tx as never, "org_a", event);
    await repository.create(tx as never, "org_b", event);

    expect(fake.rows).toHaveLength(2);
  });

  it("claims a due event exactly once and locks it before dispatch", async () => {
    const fake = fakeDatabase();
    const repository = createTransactionalOutboxRepository(fake.db as never);
    await repository.create({ outboxEvent: fake.outboxEvent } as never, "org_a", {
      topic: "message.ready",
      aggregateType: "OutreachMessage",
      aggregateId: "message_1",
      payload: {},
      idempotencyKey: "message_1:ready",
    });

    const first = await repository.claimNext();
    const second = await repository.claimNext();
    expect(first).toMatchObject({ claimed: true, event: { status: "PROCESSING", attempts: 1 } });
    expect(second).toBeNull();
  });
});
