import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthorizationError } from "@/lib/rbac";
import { assertOrganizationId, assertSameTenant, scopedWhere, tenantWhere } from "@/lib/tenant";
import { createDeliveryDispatcher } from "@/modules/delivery/queue/dispatcher";
import { createDeliveryRepository } from "@/modules/delivery/repositories/delivery.repository";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

/**
 * Tenant isolation for the delivery module (PR010): no query may run
 * without an organization scope, and the one deliberate global lookup
 * (webhook → account) must be followed by tenant-scoped work.
 */
describe("Delivery tenant isolation — primitives", () => {
  it("tenantWhere produces the canonical fragment", () => {
    expect(tenantWhere("org_1")).toEqual({ organizationId: "org_1" });
  });

  it("blank tenant ids are rejected with 403", () => {
    for (const bad of ["", "   ", null, undefined]) {
      expect(() => assertOrganizationId(bad)).toThrow(AuthorizationError);
      expect(() => assertOrganizationId(bad)).toThrow(/organization scope/);
    }
  });

  it("scopedWhere applies the tenant clause LAST (no override)", () => {
    expect(scopedWhere("org_1", { organizationId: "org_evil", status: "QUEUED" })).toEqual({
      organizationId: "org_1",
      status: "QUEUED",
    });
  });

  it("assertSameTenant hides foreign records as null (no existence leak)", () => {
    const record = { organizationId: "org_2", value: 1 };
    expect(assertSameTenant(record, "org_1")).toBeNull();
    expect(assertSameTenant(record, "org_2")).toBe(record);
    expect(assertSameTenant(null, "org_1")).toBeNull();
  });
});

describe("Delivery tenant isolation — dispatcher + repository guards", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64url");
  });

  it("dispatcher rejects a blank organizationId on every public method", async () => {
    const repository = {
      enqueueMessage: vi.fn(),
      listDispatchCandidates: vi.fn(async () => []),
      findMessageById: vi.fn(async () => null),
    };
    const dispatcher = createDeliveryDispatcher({
      db: { deliveryMessage: { updateMany: vi.fn() } } as never,
      repository: repository as never,
    });
    await expect(
      dispatcher.dispatchExecution({
        organizationId: " ",
        executionId: "e",
        status: "APPROVED",
        channel: "WHATSAPP",
        recipientId: "r",
        message: { type: "text", text: "x" },
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(dispatcher.processQueue("")).rejects.toThrow(AuthorizationError);
    await expect(dispatcher.requeueMessage("", "m1")).rejects.toThrow(AuthorizationError);
    await expect(dispatcher.cancelMessage("", "m1")).rejects.toThrow(AuthorizationError);
    expect(repository.enqueueMessage).not.toHaveBeenCalled();
  });

  it("repository find-first/by-id lookups always include organizationId", async () => {
    const seen: unknown[] = [];
    const db = {
      deliveryAccount: {},
      deliveryOAuthState: {},
      auditLog: {},
      deliveryMessage: {
        findFirst: vi.fn(async (args: unknown) => {
          seen.push(args);
          return null;
        }),
      },
    };
    const repository = createDeliveryRepository(db as never);
    await repository.findMessageById("org_1", "m1");
    await repository.findByProviderMessageId("org_1", "wamid-1");
    for (const call of seen) {
      expect(JSON.stringify(call)).toContain('"organizationId":"org_1"');
    }
    expect(seen).toHaveLength(2);
  });
});

describe("Delivery tenant isolation — module-wide source guarantees", () => {
  const moduleDir = join(__dirname, "../modules/delivery");
  const serverFiles = readdirSync(moduleDir, { recursive: true })
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => join(moduleDir, entry));

  it("every secret-touching module file is marked server-only", () => {
    const withSecrets = serverFiles.filter((file) =>
      /(auth\.service|crypto\.service|meta-client|webhook-security|client\.ts|repository|dispatcher|dashboard\.service|webhook\.ts|dm\.service|message\.service|retry\.service)/.test(
        file,
      ),
    );
    expect(withSecrets.length).toBeGreaterThanOrEqual(10);
    for (const file of withSecrets) {
      const source = readFileSync(file, "utf8");
      // retry.service is the one deliberate exception: pure math,
      // no secrets, no I/O — but it must still not leak server modules.
      if (file.endsWith("queue/retry.service.ts")) continue;
      expect(source.startsWith('import "server-only"'), file).toBe(true);
    }
  });

  it("the client-safe interface file never imports server-only or prisma values", () => {
    const source = readFileSync(join(moduleDir, "core/delivery.interface.ts"), "utf8");
    expect(source).not.toContain('import "server-only"');
    expect(source).not.toMatch(/import\s*{[^}]*}\s*from\s*"@prisma\/client"/);
  });

  it("no delivery source file ever reads NEXT_PUBLIC secrets or leaks tokens to logs", () => {
    for (const file of serverFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("NEXT_PUBLIC_META");
      expect(source).not.toMatch(/console\.log\([^)]*accessToken/);
    }
  });

  it("the meta client only targets graph.facebook.com by default", () => {
    const source = readFileSync(join(moduleDir, "core/meta-client.ts"), "utf8");
    expect(source).toContain("https://graph.facebook.com");
    expect(source).not.toMatch(
      /https?:\/\/(?!graph\.facebook\.com|www\.facebook\.com)[a-z0-9.-]+/i,
    );
  });
});
