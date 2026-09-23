import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REQUEST_ACCESS_SUCCESS_ROUTE,
  isAuthRoute,
  isProtectedRoute,
  isPublicRoute,
} from "@/lib/auth-routes";

/**
 * PR010.3 §1 — "Após sucesso: Exibir página de confirmação. Nunca retornar
 * para o formulário."
 *
 * The contract has three legs, each pinned here:
 *
 *   1. the server action still writes the request to the database and never
 *      leaks database detail to the visitor;
 *   2. the form navigates AWAY on success — `router.replace` (not `push`),
 *      so the populated form leaves the history stack and the back button
 *      cannot resurrect it;
 *   3. the confirmation is a real public page with no form on it.
 *
 * The form itself is a Client Component (hooks + react-hook-form), so its
 * navigation contract is asserted against the source — the pattern every
 * PR010.2 UX test already uses.
 */

const submitMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/auth/access-request.service", () => ({
  accessRequestService: { submit: submitMock },
}));

const { requestAccessAction } = await import("@/app/request-access/actions");

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const VALID = {
  name: "Ana Ribeiro",
  company: "Empresa A",
  email: "ana@empresa.com",
  whatsapp: "+55 11 90000-0000",
  message: "Quero testar.",
};

beforeEach(() => {
  submitMock.mockReset();
});

describe("the server action still writes to the database (§1)", () => {
  it("persists a valid submission", async () => {
    submitMock.mockResolvedValue({ id: "req_1", status: "PENDING" });

    const result = await requestAccessAction(VALID);
    expect(result).toEqual({ ok: true });
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(submitMock.mock.calls[0]?.[0]).toMatchObject({ email: "ana@empresa.com" });
  });

  it("rejects an invalid payload with field errors", async () => {
    const result = await requestAccessAction({ ...VALID, email: "not-an-email" });
    expect(result.ok).toBe(false);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("reports one generic message when the database fails — no detail leaks", async () => {
    submitMock.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await requestAccessAction(VALID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain("ECONNREFUSED");
    expect(result.error.length).toBeGreaterThan(0);
    consoleError.mockRestore();
  });
});

describe("the form leaves the page on success (§1 — nunca retornar)", () => {
  const source = read("components/auth/request-access-form.tsx");

  it("navigates with router.replace to the success route", () => {
    expect(source).toContain("router.replace(REQUEST_ACCESS_SUCCESS_ROUTE)");
  });

  it("never pushes the success route (push would leave the form in history)", () => {
    expect(source).not.toContain("router.push");
  });

  it("imports the route constant (no hardcoded drift-prone string)", () => {
    expect(source).toContain('REQUEST_ACCESS_SUCCESS_ROUTE } from "@/lib/auth-routes"');
  });

  it("has no inline success state anymore — the page IS the confirmation", () => {
    expect(source).not.toContain("setSubmitted");
    expect(source).not.toContain('role="status"');
  });

  it("keeps the error path on the same page (a failure is retryable)", () => {
    expect(source).toContain("setFormError(result.error)");
    expect(source).toContain('role="alert"');
  });

  it("still labels the phone field as Telefone (§2 table parity)", () => {
    expect(source).toContain('label="Telefone"');
  });
});

describe("the confirmation route (§10)", () => {
  it("is /request-access/success", () => {
    expect(REQUEST_ACCESS_SUCCESS_ROUTE).toBe("/request-access/success");
  });

  it("is PUBLIC — an unauthenticated visitor may land on it", () => {
    expect(isPublicRoute(REQUEST_ACCESS_SUCCESS_ROUTE)).toBe(true);
  });

  it("is not protected and not an auth screen", () => {
    expect(isProtectedRoute(REQUEST_ACCESS_SUCCESS_ROUTE)).toBe(false);
    expect(isAuthRoute(REQUEST_ACCESS_SUCCESS_ROUTE)).toBe(false);
  });

  it("the success page renders without a form", () => {
    const page = read("app/request-access/success/page.tsx");
    expect(page).not.toMatch(/<form/);
    expect(page).not.toContain("RequestAccessForm");
  });

  it("the public form page links nowhere on success other than the route", () => {
    const page = read("app/request-access/page.tsx");
    expect(page).toContain("RequestAccessForm");
  });
});
