import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import { createOutreachScheduler } from "@/modules/outreach/queue/scheduler";

function fakeDb(count = 2) {
  return {
    outreachMessage: {
      updateMany: vi.fn(async (_args: { where: unknown; data: { status: string } }) => ({ count })),
    },
  };
}

describe("Outreach scheduler", () => {
  it("promotes only due SCHEDULED messages to READY", async () => {
    const db = fakeDb();
    const now = new Date("2026-09-22T12:00:00.000Z");
    const result = await createOutreachScheduler(db as never).execute("org_a", now);
    expect(result).toMatchObject({ status: "completed", ready: 2, executedAt: now });
    expect(db.outreachMessage.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org_a", status: "SCHEDULED", scheduledFor: { lte: now } },
      data: { status: "READY" },
    });
  });
  it("never marks a message SENT", async () => {
    const db = fakeDb();
    await createOutreachScheduler(db as never).execute("org_a");
    expect(db.outreachMessage.updateMany.mock.calls[0]?.[0]?.data.status).not.toBe("SENT");
  });
  it.each(["", "   "])("rejects missing tenant %j before touching db", async (organizationId) => {
    const db = fakeDb();
    await expect(createOutreachScheduler(db as never).execute(organizationId)).rejects.toThrow(
      AuthorizationError,
    );
    expect(db.outreachMessage.updateMany).not.toHaveBeenCalled();
  });
  it("returns a failed job result when the database fails", async () => {
    const db = {
      outreachMessage: {
        updateMany: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    };
    await expect(createOutreachScheduler(db as never).execute("org_a")).resolves.toMatchObject({
      status: "failed",
      ready: 0,
      error: "db down",
    });
  });
});
