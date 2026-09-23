import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signup E2E flow at the server-action boundary.
 *
 * The browser submits the same payload, the action performs its readiness
 * probe, provisions a complete tenant, signs in with the credentials provider
 * and sends the client to /dashboard. Infrastructure is mocked only at the
 * database/NextAuth edges, keeping this deterministic in CI without a shared
 * production Postgres instance.
 */
const healthMock = vi.hoisted(() => vi.fn());
const registerMock = vi.hoisted(() => vi.fn());
const signInMock = vi.hoisted(() => vi.fn());

class FakeSignupError extends Error {}
class FakeSignupReadinessError extends Error {}
class FakeAuthError extends Error {}
class FakeKnownPrismaError extends Error {}

vi.mock("@/lib/auth", () => ({ signIn: signInMock }));
vi.mock("@/modules/auth/signup-health.service", () => ({
  assertSignupReady: healthMock,
  SignupReadinessError: FakeSignupReadinessError,
}));
vi.mock("@/modules/auth/signup.service", () => ({
  signupService: { register: registerMock },
  SignupError: FakeSignupError,
}));
vi.mock("next-auth", () => ({ AuthError: FakeAuthError }));
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, Prisma: { PrismaClientKnownRequestError: FakeKnownPrismaError } };
});

const { signupAction } = await import("@/app/signup/actions");

const COMPLETE_SIGNUP = {
  name: "Ana Ribeiro",
  company: "Brobond Commerce",
  whatsapp: "(11) 98888-7777",
  email: "ana@brobond.ai",
  password: "senha-super-secreta",
  confirmPassword: "senha-super-secreta",
  acceptTerms: true,
};

beforeEach(() => {
  healthMock.mockReset().mockResolvedValue({ connected: true });
  registerMock.mockReset().mockResolvedValue({
    userId: "user_e2e",
    organizationId: "org_e2e",
    email: COMPLETE_SIGNUP.email,
  });
  signInMock.mockReset().mockResolvedValue(undefined);
});

describe("E2E — criar conta, entrar automaticamente e abrir dashboard", () => {
  it("creates the complete account, establishes a credentials session and redirects to /dashboard", async () => {
    const flow: string[] = [];
    healthMock.mockImplementation(async () => flow.push("healthcheck"));
    registerMock.mockImplementation(async () => flow.push("provision"));
    signInMock.mockImplementation(async () => flow.push("login"));

    const result = await signupAction(COMPLETE_SIGNUP);

    expect(flow).toEqual(["healthcheck", "provision", "login"]);
    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ana@brobond.ai",
        whatsapp: "11988887777",
      }),
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "ana@brobond.ai",
      password: COMPLETE_SIGNUP.password,
      redirect: false,
    });
    expect(result).toEqual({ ok: true, redirectTo: "/dashboard" });
  });
});
