import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";

/**
 * PR010.4 §9 — the first-run onboarding checklist.
 *
 * "Após primeiro login, exibir onboarding: Conectar TikTok · Importar
 * Produtos · Criar Creator · Criar Campanha."
 *
 * The checklist is DERIVED from live tenant counts, never stored, so these
 * tests are mostly about one question: can the panel ever disagree with what
 * is actually in the workspace? It must not.
 *
 * Tenant isolation is the second theme: every count must carry the caller's
 * `organizationId`, and a missing tenant must throw rather than silently
 * counting another workspace's rows.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { createOnboardingService } = await import("@/modules/auth/onboarding.service");

const ORG = "org_tenant_a";

interface Counts {
  products: number;
  creators: number;
  campaigns: number;
  tiktokAccounts: number;
}

function makeDb(counts: Partial<Counts> = {}, onboardingCompletedAt: Date | null = null) {
  const resolved: Counts = {
    products: 0,
    creators: 0,
    campaigns: 0,
    tiktokAccounts: 0,
    ...counts,
  };

  const organizationRow = { id: ORG, onboardingCompletedAt };

  const db = {
    organization: {
      findUnique: vi.fn(
        async (_args: { where: { id: string }; select: Record<string, boolean> }) =>
          organizationRow,
      ),
      update: vi.fn(async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(organizationRow, data);
        return organizationRow;
      }),
    },
    product: { count: vi.fn(async () => resolved.products) },
    creatorProfile: { count: vi.fn(async () => resolved.creators) },
    campaign: { count: vi.fn(async () => resolved.campaigns) },
    tikTokAccount: { count: vi.fn(async () => resolved.tiktokAccounts) },
  };

  return { db, organizationRow };
}

let fake: ReturnType<typeof makeDb>;
let service: ReturnType<typeof createOnboardingService>;

function build(counts: Partial<Counts> = {}, completedAt: Date | null = null) {
  fake = makeDb(counts, completedAt);
  service = createOnboardingService(fake.db as never);
  return service;
}

beforeEach(() => {
  build();
});

// ------------------------------------------------------------------
// The four steps
// ------------------------------------------------------------------

describe("getState() — the §9 steps", () => {
  it("returns exactly four steps", async () => {
    const state = await service.getState(ORG);
    expect(state.steps).toHaveLength(4);
    expect(state.total).toBe(4);
  });

  it("returns them in the §9 order", async () => {
    const state = await service.getState(ORG);
    expect(state.steps.map((step) => step.title)).toEqual([
      "Conectar TikTok",
      "Importar Produtos",
      "Criar Creator",
      "Criar Campanha",
    ]);
  });

  it("gives every step a link", async () => {
    const state = await service.getState(ORG);
    for (const step of state.steps) {
      expect(step.href).toMatch(/^\/dashboard/);
    }
  });

  it("gives every step a description", async () => {
    const state = await service.getState(ORG);
    for (const step of state.steps) {
      expect(step.description.length).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------------
// Derived completion
// ------------------------------------------------------------------

describe("getState() — derived completion", () => {
  it("marks everything undone for a brand-new tenant", async () => {
    const state = await service.getState(ORG);
    expect(state.steps.every((step) => !step.done)).toBe(true);
    expect(state.completed).toBe(0);
  });

  it("ticks Conectar TikTok once an account exists", async () => {
    const state = await build({ tiktokAccounts: 1 }).getState(ORG);
    expect(state.steps.find((step) => step.id === "connect-tiktok")?.done).toBe(true);
  });

  it("ticks Importar Produtos once a product exists", async () => {
    const state = await build({ products: 1 }).getState(ORG);
    expect(state.steps.find((step) => step.id === "import-products")?.done).toBe(true);
  });

  it("ticks Criar Creator once a creator exists", async () => {
    const state = await build({ creators: 1 }).getState(ORG);
    expect(state.steps.find((step) => step.id === "create-creator")?.done).toBe(true);
  });

  it("ticks Criar Campanha once a campaign exists", async () => {
    const state = await build({ campaigns: 1 }).getState(ORG);
    expect(state.steps.find((step) => step.id === "create-campaign")?.done).toBe(true);
  });

  it("counts partial progress", async () => {
    const state = await build({ products: 3, creators: 2 }).getState(ORG);
    expect(state.completed).toBe(2);
  });

  it("reports `finished` only when all four are done", async () => {
    const partial = await build({ products: 1, creators: 1, campaigns: 1 }).getState(ORG);
    expect(partial.finished).toBe(false);

    const all = await build({
      products: 1,
      creators: 1,
      campaigns: 1,
      tiktokAccounts: 1,
    }).getState(ORG);
    expect(all.finished).toBe(true);
  });

  it("ticks a step regardless of HOW the record was created", async () => {
    // 400 products imported by the TikTok sync count exactly like one typed
    // by hand — the checklist asks about reality, not about which button was
    // pressed.
    const state = await build({ products: 400 }).getState(ORG);
    expect(state.steps.find((step) => step.id === "import-products")?.done).toBe(true);
  });

  it("exposes the raw progress map for callers that want it", async () => {
    const state = await build({ products: 1 }).getState(ORG);
    expect(state.progress["import-products"]).toBe(true);
    expect(state.progress["create-campaign"]).toBe(false);
  });
});

// ------------------------------------------------------------------
// Visibility
// ------------------------------------------------------------------

describe("getState() — when the panel shows", () => {
  it("is visible for a brand-new tenant", async () => {
    const state = await service.getState(ORG);
    expect(state.visible).toBe(true);
  });

  it("stays visible while any step remains", async () => {
    const state = await build({ products: 1, creators: 1, campaigns: 1 }).getState(ORG);
    expect(state.visible).toBe(true);
  });

  it("hides itself once every step is done", async () => {
    const state = await build({
      products: 1,
      creators: 1,
      campaigns: 1,
      tiktokAccounts: 1,
    }).getState(ORG);
    expect(state.visible).toBe(false);
  });

  it("hides itself once dismissed, even with steps outstanding", async () => {
    const state = await build({}, new Date("2026-09-01")).getState(ORG);
    expect(state.visible).toBe(false);
    expect(state.finished).toBe(false);
  });

  it("still reports accurate progress after being dismissed", async () => {
    const state = await build({ products: 1 }, new Date("2026-09-01")).getState(ORG);
    expect(state.completed).toBe(1);
  });
});

// ------------------------------------------------------------------
// Tenant isolation
// ------------------------------------------------------------------

describe("getState() — tenant isolation", () => {
  it("scopes the product count to the caller's tenant", async () => {
    await service.getState(ORG);
    expect(fake.db.product.count).toHaveBeenCalledWith({ where: { organizationId: ORG } });
  });

  it("scopes the creator count", async () => {
    await service.getState(ORG);
    expect(fake.db.creatorProfile.count).toHaveBeenCalledWith({
      where: { organizationId: ORG },
    });
  });

  it("scopes the campaign count", async () => {
    await service.getState(ORG);
    expect(fake.db.campaign.count).toHaveBeenCalledWith({ where: { organizationId: ORG } });
  });

  it("scopes the TikTok account count", async () => {
    await service.getState(ORG);
    expect(fake.db.tikTokAccount.count).toHaveBeenCalledWith({
      where: { organizationId: ORG },
    });
  });

  it("looks the organization up by the caller's id", async () => {
    await service.getState(ORG);
    expect(fake.db.organization.findUnique.mock.calls[0]![0].where).toEqual({ id: ORG });
  });

  it("throws for a missing tenant rather than counting everything", async () => {
    await expect(service.getState("")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("throws for a null tenant", async () => {
    await expect(service.getState(null as never)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("throws for a whitespace tenant", async () => {
    await expect(service.getState("   ")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("reads nothing when the tenant is missing", async () => {
    await service.getState("").catch(() => undefined);
    expect(fake.db.product.count).not.toHaveBeenCalled();
  });

  it("never selects a secret from the organization", async () => {
    await service.getState(ORG);
    const select = fake.db.organization.findUnique.mock.calls[0]![0].select;
    expect(Object.keys(select)).toEqual(["onboardingCompletedAt"]);
  });
});

// ------------------------------------------------------------------
// dismiss()
// ------------------------------------------------------------------

describe("dismiss()", () => {
  it("records the dismissal timestamp", async () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    await service.dismiss(ORG, now);
    expect(fake.organizationRow.onboardingCompletedAt).toBe(now);
  });

  it("hides the panel afterwards", async () => {
    await service.dismiss(ORG, new Date());
    const state = await service.getState(ORG);
    expect(state.visible).toBe(false);
  });

  it("is idempotent — a second dismissal keeps the original timestamp", async () => {
    const first = new Date("2026-09-01T00:00:00.000Z");
    await service.dismiss(ORG, first);
    await service.dismiss(ORG, new Date("2026-09-23T00:00:00.000Z"));

    expect(fake.organizationRow.onboardingCompletedAt).toBe(first);
  });

  it("does not write at all on a repeat dismissal", async () => {
    await service.dismiss(ORG, new Date());
    fake.db.organization.update.mockClear();
    await service.dismiss(ORG, new Date());

    expect(fake.db.organization.update).not.toHaveBeenCalled();
  });

  it("scopes the write to the caller's tenant", async () => {
    await service.dismiss(ORG, new Date());
    expect(fake.db.organization.update.mock.calls[0]![0].where).toEqual({ id: ORG });
  });

  it("writes ONLY the dismissal column", async () => {
    await service.dismiss(ORG, new Date());
    const data = fake.db.organization.update.mock.calls[0]![0].data;
    expect(Object.keys(data)).toEqual(["onboardingCompletedAt"]);
  });

  it("throws for a missing tenant", async () => {
    await expect(service.dismiss("")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("writes nothing when the tenant is missing", async () => {
    await service.dismiss("").catch(() => undefined);
    expect(fake.db.organization.update).not.toHaveBeenCalled();
  });

  it("defaults the clock to now", async () => {
    const before = Date.now();
    await service.dismiss(ORG);
    const written = fake.organizationRow.onboardingCompletedAt as Date;
    expect(written.getTime()).toBeGreaterThanOrEqual(before);
  });
});
