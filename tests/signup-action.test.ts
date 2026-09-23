import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR010.4 §4 · §8 — the `/signup` server action.
 *
 * This is where the three promises of the PR meet:
 *
 *   §4  "Entrar automaticamente" → the action signs the user in after
 *       provisioning, and returns a SERVER-decided destination;
 *   §8  every failure is attributable to a field, and the summary never
 *       degrades to "Revise os campos destacados";
 *   security → the role is never an input, and the redirect is sanitised.
 *
 * The service and NextAuth are mocked at the seam: their own behaviour is
 * covered by `signup-service.test.ts` and by NextAuth itself. What is under
 * test here is the ORCHESTRATION and the SHAPE OF THE RESULT.
 */

const registerMock = vi.hoisted(() => vi.fn());
const signInMock = vi.hoisted(() => vi.fn());

class FakeSignupError extends Error {
  constructor(
    public code: string,
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = "SignupError";
  }
}

class FakeAuthError extends Error {
  type = "CredentialsSignin";
}

class FakePrismaKnownError extends Error {
  constructor(
    public code: string,
    public meta?: Record<string, unknown>,
  ) {
    super(`Prisma error ${code}`);
    this.name = "PrismaClientKnownRequestError";
  }
}

vi.mock("@/lib/auth", () => ({ signIn: signInMock }));
vi.mock("next-auth", () => ({ AuthError: FakeAuthError }));
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Prisma: { PrismaClientKnownRequestError: FakePrismaKnownError },
  };
});
vi.mock("@/modules/auth/signup.service", () => ({
  signupService: { register: registerMock },
  SignupError: FakeSignupError,
}));

const { signupAction } = await import("@/app/signup/actions");

const VALID = {
  name: "Ana Ribeiro",
  company: "Brobond Commerce",
  whatsapp: "(11) 98888-7777",
  email: "ana@brobond.ai",
  password: "senha-super-secreta",
  confirmPassword: "senha-super-secreta",
  acceptTerms: true,
};

const PROVISIONED = {
  userId: "user_1",
  email: "ana@brobond.ai",
  name: "Ana Ribeiro",
  role: "ADMIN",
  organizationId: "org_1",
  organizationSlug: "brobond-commerce",
  workspaceName: "Brobond Commerce",
};

beforeEach(() => {
  registerMock.mockReset().mockResolvedValue(PROVISIONED);
  signInMock.mockReset().mockResolvedValue(undefined);
});

// ------------------------------------------------------------------
// §4 — the happy path
// ------------------------------------------------------------------

describe("signupAction() — success", () => {
  it("succeeds for a valid payload", async () => {
    await expect(signupAction(VALID)).resolves.toMatchObject({ ok: true });
  });

  it("provisions the tenant exactly once", async () => {
    await signupAction(VALID);
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it("passes the PARSED data to the service, not the raw input", async () => {
    await signupAction({ ...VALID, email: "  Ana@Brobond.AI " });
    expect(registerMock.mock.calls[0]![0].email).toBe("ana@brobond.ai");
  });

  it("passes the normalized WhatsApp digits to the service", async () => {
    await signupAction(VALID);
    expect(registerMock.mock.calls[0]![0].whatsapp).toBe("11988887777");
  });

  it("signs the user in automatically (§4)", async () => {
    await signupAction(VALID);
    expect(signInMock).toHaveBeenCalledTimes(1);
  });

  it("signs in with the credentials provider", async () => {
    await signupAction(VALID);
    expect(signInMock.mock.calls[0]![0]).toBe("credentials");
  });

  it("signs in with the email and password the user just chose", async () => {
    await signupAction(VALID);
    expect(signInMock.mock.calls[0]![1]).toMatchObject({
      email: "ana@brobond.ai",
      password: VALID.password,
    });
  });

  it("asks NextAuth not to redirect — the action returns the destination", async () => {
    await signupAction(VALID);
    expect(signInMock.mock.calls[0]![1].redirect).toBe(false);
  });

  it("provisions BEFORE signing in", async () => {
    const order: string[] = [];
    registerMock.mockImplementation(async () => {
      order.push("register");
      return PROVISIONED;
    });
    signInMock.mockImplementation(async () => {
      order.push("signIn");
    });

    await signupAction(VALID);
    expect(order).toEqual(["register", "signIn"]);
  });

  it("redirects to /dashboard by default (§4)", async () => {
    const result = await signupAction(VALID);
    expect(result).toMatchObject({ ok: true, redirectTo: "/dashboard" });
  });

  it("honours a safe ?next= destination", async () => {
    const result = await signupAction({ ...VALID, next: "/dashboard/products" });
    expect(result).toMatchObject({ redirectTo: "/dashboard/products" });
  });

  it("never returns the password", async () => {
    const result = await signupAction(VALID);
    expect(JSON.stringify(result)).not.toContain(VALID.password);
  });

  it("never returns an organization id or user id", async () => {
    const result = await signupAction(VALID);
    expect(result).not.toHaveProperty("organizationId");
    expect(result).not.toHaveProperty("userId");
  });
});

// ------------------------------------------------------------------
// Open redirect
// ------------------------------------------------------------------

describe("signupAction() — the redirect is decided by the SERVER", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "http://evil.example/dashboard",
  ])("collapses the hostile destination %s to /dashboard", async (next) => {
    const result = await signupAction({ ...VALID, next });
    expect(result).toMatchObject({ ok: true, redirectTo: "/dashboard" });
  });

  it("refuses to bounce back into an auth screen", async () => {
    const result = await signupAction({ ...VALID, next: "/login" });
    expect(result).toMatchObject({ redirectTo: "/dashboard" });
  });

  it("refuses to bounce back into /signup itself", async () => {
    const result = await signupAction({ ...VALID, next: "/signup" });
    expect(result).toMatchObject({ redirectTo: "/dashboard" });
  });

  it("rejects a CRLF-injected destination", async () => {
    const result = await signupAction({ ...VALID, next: "/dashboard\r\nSet-Cookie: x=1" });
    expect(result).toMatchObject({ redirectTo: "/dashboard" });
  });
});

// ------------------------------------------------------------------
// §8 — validation errors are FIELD errors
// ------------------------------------------------------------------

describe("signupAction() — §8 error contract", () => {
  it("fails a payload that is not an object", async () => {
    await expect(signupAction(null)).resolves.toMatchObject({ ok: false });
  });

  it("returns fieldErrors for an empty submission", async () => {
    const result = await signupAction({});
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.fieldErrors).toBeTruthy();
  });

  it("names EVERY invalid field", async () => {
    const result = await signupAction({});
    if (result.ok) throw new Error("expected failure");

    for (const field of ["name", "company", "whatsapp", "email", "password", "acceptTerms"]) {
      expect(result.fieldErrors, field).toHaveProperty(field);
    }
  });

  it("never returns the generic 'Revise os campos destacados'", async () => {
    const result = await signupAction({});
    if (result.ok) throw new Error("expected failure");
    expect(result.error).not.toMatch(/Revise os campos destacados/i);
  });

  it("uses a CONCRETE first problem as the summary", async () => {
    const result = await signupAction({ ...VALID, company: "" });
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("Informe o nome da empresa.");
  });

  it("reports a short password on the password field", async () => {
    const result = await signupAction({ ...VALID, password: "abc", confirmPassword: "abc" });
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors?.password?.[0]).toMatch(/ao menos 8 caracteres/);
  });

  it("reports an invalid WhatsApp on the whatsapp field", async () => {
    const result = await signupAction({ ...VALID, whatsapp: "123" });
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors?.whatsapp?.[0]).toMatch(/WhatsApp inválido/);
  });

  it("reports a missing company on the company field", async () => {
    const result = await signupAction({ ...VALID, company: "" });
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors?.company?.[0]).toBe("Informe o nome da empresa.");
  });

  it("reports an unaccepted term on the acceptTerms field", async () => {
    const result = await signupAction({ ...VALID, acceptTerms: false });
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors?.acceptTerms?.[0]).toMatch(/aceitar os termos/);
  });

  it("reports a password mismatch on the confirmation field", async () => {
    const result = await signupAction({ ...VALID, confirmPassword: "outra-coisa-aqui" });
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors?.confirmPassword?.[0]).toBe("As senhas não coincidem.");
  });

  it("provisions NOTHING when validation fails", async () => {
    await signupAction({});
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("signs NOBODY in when validation fails", async () => {
    await signupAction({});
    expect(signInMock).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// Duplicate email
// ------------------------------------------------------------------

describe("signupAction() — duplicate email", () => {
  it("maps a SignupError to its own field", async () => {
    registerMock.mockRejectedValue(
      new FakeSignupError("EMAIL_TAKEN", "email", "Este email já está sendo utilizado."),
    );

    const result = await signupAction(VALID);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors?.email?.[0]).toMatch(/já está sendo utilizado/);
  });

  it("echoes the service's message as the summary", async () => {
    registerMock.mockRejectedValue(
      new FakeSignupError("EMAIL_TAKEN", "email", "Este email já está sendo utilizado."),
    );

    const result = await signupAction(VALID);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/já está sendo utilizado/);
  });

  it("maps the database unique-index violation (P2002) to the email field", async () => {
    registerMock.mockRejectedValue(new FakePrismaKnownError("P2002", { target: ["email"] }));

    const result = await signupAction(VALID);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors?.email?.[0]).toMatch(/já está sendo utilizado/);
  });

  it("does not sign anybody in after a duplicate", async () => {
    registerMock.mockRejectedValue(
      new FakeSignupError("EMAIL_TAKEN", "email", "Este email já está sendo utilizado."),
    );

    await signupAction(VALID);
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("never leaks a database error string to the user", async () => {
    registerMock.mockRejectedValue(new FakePrismaKnownError("P2002", { target: ["email"] }));

    const result = await signupAction(VALID);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).not.toMatch(/Prisma|P2002|unique/i);
  });
});

// ------------------------------------------------------------------
// Server faults
// ------------------------------------------------------------------

describe("signupAction() — unexpected failures", () => {
  it("returns a generic message for an unknown provisioning error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerMock.mockRejectedValue(new Error("connection reset"));

    const result = await signupAction(VALID);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/Não foi possível criar sua conta/);
  });

  it("never leaks the internal error message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerMock.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432"));

    const result = await signupAction(VALID);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).not.toContain("10.0.0.5");
  });

  it("attaches NO fieldErrors to a server fault — it belongs to no field", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerMock.mockRejectedValue(new Error("boom"));

    const result = await signupAction(VALID);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors).toBeUndefined();
  });

  it("tells the user the ACCOUNT EXISTS when only the auto-login fails", async () => {
    signInMock.mockRejectedValue(new FakeAuthError("no"));

    const result = await signupAction(VALID);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/conta foi criada/i);
  });

  it("directs them to log in when the auto-login fails", async () => {
    signInMock.mockRejectedValue(new FakeAuthError("no"));

    const result = await signupAction(VALID);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/Faça login/i);
  });

  it("re-throws a non-AuthError from signIn (e.g. a redirect signal)", async () => {
    const redirectSignal = new Error("NEXT_REDIRECT");
    signInMock.mockRejectedValue(redirectSignal);

    await expect(signupAction(VALID)).rejects.toBe(redirectSignal);
  });
});

// ------------------------------------------------------------------
// Privilege escalation
// ------------------------------------------------------------------

describe("signupAction() — the role is never an input", () => {
  it("strips a role from the payload before it reaches the service", async () => {
    await signupAction({ ...VALID, role: "ADMIN" });
    expect(registerMock.mock.calls[0]![0]).not.toHaveProperty("role");
  });

  it("strips an organizationId from the payload", async () => {
    await signupAction({ ...VALID, organizationId: "org_victim" });
    expect(registerMock.mock.calls[0]![0]).not.toHaveProperty("organizationId");
  });

  it("strips a passwordHash from the payload", async () => {
    await signupAction({ ...VALID, passwordHash: "$2a$12$fake" });
    expect(registerMock.mock.calls[0]![0]).not.toHaveProperty("passwordHash");
  });

  it("strips an emailVerified from the payload", async () => {
    await signupAction({ ...VALID, emailVerified: new Date() });
    expect(registerMock.mock.calls[0]![0]).not.toHaveProperty("emailVerified");
  });
});
