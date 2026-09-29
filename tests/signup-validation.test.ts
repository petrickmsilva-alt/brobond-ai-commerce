import { describe, expect, it } from "vitest";
import {
  COMPANY_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SIGNUP_FIELDS,
  companySchema,
  fullNameSchema,
  normalizeWhatsapp,
  signupFormSchema,
  signupSchema,
  termsSchema,
  whatsappSchema,
} from "@/lib/validations/auth";

/**
 * PR010.4 §3 · §8 — the signup validator.
 *
 * This is the file that decides what a user is told when they get something
 * wrong, so it is tested for its MESSAGES as much as for its verdicts. §8 is
 * explicit: "Exibir erro abaixo do campo… Nunca mostrar apenas 'Revise os
 * campos destacados'." A rejection with a useless message is a bug here, not
 * a cosmetic issue, and these tests treat it as one.
 */

/** A payload that passes every rule — each test breaks exactly one thing. */
const VALID = {
  name: "Ana Ribeiro",
  company: "Brobond Commerce",
  whatsapp: "(11) 98888-7777",
  email: "ana@brobond.ai",
  password: "senha-super-secreta",
  confirmPassword: "senha-super-secreta",
  acceptTerms: true as const,
  next: null,
};

/** First error message for a field, or `null` when the field passed. */
function errorFor(payload: Record<string, unknown>, field: string): string | null {
  const parsed = signupSchema.safeParse(payload);
  if (parsed.success) return null;
  const issue = parsed.error.issues.find((item) => item.path[0] === field);
  return issue?.message ?? null;
}

describe("signupSchema — the happy path", () => {
  it("accepts a complete, valid payload", () => {
    expect(signupSchema.safeParse(VALID).success).toBe(true);
  });

  it("returns the parsed data, not the raw input", () => {
    const parsed = signupSchema.parse(VALID);
    expect(parsed.email).toBe("ana@brobond.ai");
    expect(parsed.name).toBe("Ana Ribeiro");
  });

  it("exposes every rendered field in SIGNUP_FIELDS", () => {
    expect(SIGNUP_FIELDS).toEqual([
      "name",
      "company",
      "whatsapp",
      "email",
      "password",
      "confirmPassword",
      "acceptTerms",
    ]);
  });

  it("the form schema is the same schema the server uses", () => {
    // Client and server validating different rules is how a form comes to
    // promise something the action then rejects.
    expect(signupFormSchema).toBe(signupSchema);
  });

  it("carries no `role` field — ADMIN is decided server-side", () => {
    const parsed = signupSchema.parse({ ...VALID, role: "ADMIN" }) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("role");
  });

  it("ignores any organizationId a client tries to smuggle in", () => {
    const parsed = signupSchema.parse({ ...VALID, organizationId: "org_victim" }) as Record<
      string,
      unknown
    >;
    expect(parsed).not.toHaveProperty("organizationId");
  });
});

// ------------------------------------------------------------------
// Nome completo
// ------------------------------------------------------------------

describe("nome completo", () => {
  it("is required", () => {
    expect(errorFor({ ...VALID, name: "" }, "name")).toBe("Informe seu nome completo.");
  });

  it("is required when the field is only whitespace", () => {
    expect(errorFor({ ...VALID, name: "   " }, "name")).toBe("Informe seu nome completo.");
  });

  it("is required when the key is missing entirely", () => {
    const { name: _omitted, ...withoutName } = VALID;
    expect(errorFor(withoutName, "name")).toBe("Informe seu nome completo.");
  });

  it("rejects a name shorter than 3 characters WITH a specific message", () => {
    expect(errorFor({ ...VALID, name: "Jo" }, "name")).toBe(
      "Seu nome deve ter ao menos 3 caracteres.",
    );
  });

  it("accepts a 3-character name", () => {
    expect(errorFor({ ...VALID, name: "Ana" }, "name")).toBeNull();
  });

  it("rejects a name made only of digits", () => {
    expect(errorFor({ ...VALID, name: "123456" }, "name")).toMatch(/nome válido/i);
  });

  it("accepts accented Portuguese names", () => {
    expect(errorFor({ ...VALID, name: "João Conceição" }, "name")).toBeNull();
  });

  it("accepts a name with an apostrophe or hyphen", () => {
    expect(errorFor({ ...VALID, name: "Ana-Maria D'Ávila" }, "name")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(signupSchema.parse({ ...VALID, name: "  Ana Ribeiro  " }).name).toBe("Ana Ribeiro");
  });

  it(`rejects a name longer than ${NAME_MAX_LENGTH} characters`, () => {
    const message = errorFor({ ...VALID, name: "a".repeat(NAME_MAX_LENGTH + 1) }, "name");
    expect(message).toContain(String(NAME_MAX_LENGTH));
  });

  it(`accepts a name of exactly ${NAME_MAX_LENGTH} characters`, () => {
    expect(errorFor({ ...VALID, name: "a".repeat(NAME_MAX_LENGTH) }, "name")).toBeNull();
  });

  it("is exported standalone for per-field use", () => {
    expect(fullNameSchema.safeParse("Ana Ribeiro").success).toBe(true);
    expect(fullNameSchema.safeParse("").success).toBe(false);
  });
});

// ------------------------------------------------------------------
// Empresa
// ------------------------------------------------------------------

describe("empresa", () => {
  it("is required — the §8 example message, verbatim", () => {
    expect(errorFor({ ...VALID, company: "" }, "company")).toBe("Informe o nome da empresa.");
  });

  it("is required when only whitespace", () => {
    expect(errorFor({ ...VALID, company: "  " }, "company")).toBe("Informe o nome da empresa.");
  });

  it("is required when the key is missing entirely", () => {
    const { company: _omitted, ...withoutCompany } = VALID;
    expect(errorFor(withoutCompany, "company")).toBe("Informe o nome da empresa.");
  });

  it("rejects a single character with its own message", () => {
    expect(errorFor({ ...VALID, company: "X" }, "company")).toBe(
      "O nome da empresa deve ter ao menos 2 caracteres.",
    );
  });

  it("accepts a 2-character company", () => {
    expect(errorFor({ ...VALID, company: "3M" }, "company")).toBeNull();
  });

  it("accepts a company that is mostly digits (e.g. '99 Taxis')", () => {
    expect(errorFor({ ...VALID, company: "99 Taxis" }, "company")).toBeNull();
  });

  it("rejects a company made only of punctuation", () => {
    expect(errorFor({ ...VALID, company: "***" }, "company")).toMatch(/empresa válido/i);
  });

  it("accepts accents and legal suffixes", () => {
    expect(errorFor({ ...VALID, company: "Açaí & Cia Ltda." }, "company")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(signupSchema.parse({ ...VALID, company: "  Brobond  " }).company).toBe("Brobond");
  });

  it(`rejects a company longer than ${COMPANY_MAX_LENGTH} characters`, () => {
    const message = errorFor({ ...VALID, company: "a".repeat(COMPANY_MAX_LENGTH + 1) }, "company");
    expect(message).toContain(String(COMPANY_MAX_LENGTH));
  });

  it("is exported standalone for per-field use", () => {
    expect(companySchema.safeParse("Brobond").success).toBe(true);
    expect(companySchema.safeParse("").success).toBe(false);
  });
});

// ------------------------------------------------------------------
// WhatsApp
// ------------------------------------------------------------------

describe("whatsapp", () => {
  it("is REQUIRED in PR010.4 (it was optional on the old access request)", () => {
    expect(errorFor({ ...VALID, whatsapp: "" }, "whatsapp")).toBe("Informe seu WhatsApp.");
  });

  it("is required when the key is missing entirely", () => {
    const { whatsapp: _omitted, ...without } = VALID;
    expect(errorFor(without, "whatsapp")).toBe("Informe seu WhatsApp.");
  });

  it.each([
    "(11) 98888-7777",
    "11988887777",
    "+55 11 98888-7777",
    "+55 (11) 98888.7777",
    "11 3333-4444",
  ])("accepts a real-world format: %s", (value) => {
    expect(errorFor({ ...VALID, whatsapp: value }, "whatsapp")).toBeNull();
  });

  it("rejects fewer than 10 digits WITH the §8 'WhatsApp inválido' message", () => {
    const message = errorFor({ ...VALID, whatsapp: "988877" }, "whatsapp");
    expect(message).toMatch(/WhatsApp inválido/);
    expect(message).toMatch(/DDD/);
  });

  it("rejects a mobile number typed without its DDD", () => {
    expect(errorFor({ ...VALID, whatsapp: "988887777" }, "whatsapp")).toMatch(/WhatsApp inválido/);
  });

  it("accepts exactly 10 digits (landline with DDD)", () => {
    expect(errorFor({ ...VALID, whatsapp: "1133334444" }, "whatsapp")).toBeNull();
  });

  it("accepts exactly 11 digits (mobile with DDD)", () => {
    expect(errorFor({ ...VALID, whatsapp: "11988887777" }, "whatsapp")).toBeNull();
  });

  it("rejects more than 15 digits (beyond E.164)", () => {
    expect(errorFor({ ...VALID, whatsapp: "1".repeat(16) }, "whatsapp")).toMatch(/longo demais/);
  });

  it("rejects letters with a message about which characters are allowed", () => {
    const message = errorFor({ ...VALID, whatsapp: "11 9ABCD-7777" }, "whatsapp");
    expect(message).toMatch(/Use apenas números/);
  });

  it("rejects an obvious injection attempt", () => {
    expect(errorFor({ ...VALID, whatsapp: "11988887777; DROP TABLE" }, "whatsapp")).toBeTruthy();
  });

  it("normalizes to digits only — punctuation never reaches the database", () => {
    expect(signupSchema.parse({ ...VALID, whatsapp: "+55 (11) 98888-7777" }).whatsapp).toBe(
      "5511988887777",
    );
  });

  it("normalizes a plain number unchanged", () => {
    expect(signupSchema.parse({ ...VALID, whatsapp: "11988887777" }).whatsapp).toBe("11988887777");
  });

  it("exposes `normalizeWhatsapp` as a pure helper", () => {
    expect(normalizeWhatsapp("(11) 98888-7777")).toBe("11988887777");
    expect(normalizeWhatsapp("+55 11 9 8888 7777")).toBe("5511988887777");
    expect(normalizeWhatsapp("abc")).toBe("");
  });

  it("is exported standalone for per-field use", () => {
    expect(whatsappSchema.safeParse("11988887777").success).toBe(true);
    expect(whatsappSchema.safeParse("123").success).toBe(false);
  });
});

// ------------------------------------------------------------------
// Email
// ------------------------------------------------------------------

describe("email", () => {
  it("rejects a malformed address", () => {
    expect(errorFor({ ...VALID, email: "not-an-email" }, "email")).toBe("Informe um email válido.");
  });

  it("rejects an empty address", () => {
    expect(errorFor({ ...VALID, email: "" }, "email")).toBeTruthy();
  });

  it.each(["ana@", "@brobond.ai", "ana brobond.ai", "ana@@brobond.ai"])("rejects %s", (value) => {
    expect(errorFor({ ...VALID, email: value }, "email")).toBeTruthy();
  });

  it("lowercases the address so capitalisation can never split an account", () => {
    expect(signupSchema.parse({ ...VALID, email: "Ana@Brobond.AI" }).email).toBe("ana@brobond.ai");
  });

  it("trims surrounding whitespace", () => {
    expect(signupSchema.parse({ ...VALID, email: "  ana@brobond.ai  " }).email).toBe(
      "ana@brobond.ai",
    );
  });

  it("rejects an address longer than 320 characters", () => {
    const long = `${"a".repeat(320)}@brobond.ai`;
    expect(errorFor({ ...VALID, email: long }, "email")).toBeTruthy();
  });

  it("accepts a plus-addressed inbox", () => {
    expect(errorFor({ ...VALID, email: "ana+brobond@gmail.com" }, "email")).toBeNull();
  });
});

// ------------------------------------------------------------------
// Senha e confirmação
// ------------------------------------------------------------------

describe("senha", () => {
  it("rejects a short password WITH the §8 'senha muito curta' message", () => {
    const message = errorFor({ ...VALID, password: "abc", confirmPassword: "abc" }, "password");
    expect(message).toBe(`A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  });

  it(`accepts a password of exactly ${PASSWORD_MIN_LENGTH} characters`, () => {
    const eight = "a".repeat(PASSWORD_MIN_LENGTH);
    expect(errorFor({ ...VALID, password: eight, confirmPassword: eight }, "password")).toBeNull();
  });

  it(`rejects a password one character below the minimum`, () => {
    const seven = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    expect(
      errorFor({ ...VALID, password: seven, confirmPassword: seven }, "password"),
    ).toBeTruthy();
  });

  it("rejects a password longer than 256 characters", () => {
    const long = "a".repeat(257);
    expect(errorFor({ ...VALID, password: long, confirmPassword: long }, "password")).toMatch(
      /256/,
    );
  });

  it("never trims the password — leading/trailing spaces are part of it", () => {
    const padded = "  senha secreta  ";
    expect(
      signupSchema.parse({ ...VALID, password: padded, confirmPassword: padded }).password,
    ).toBe(padded);
  });
});

describe("confirmar senha", () => {
  it("reports a mismatch ON THE CONFIRMATION FIELD, not on the password", () => {
    const parsed = signupSchema.safeParse({ ...VALID, confirmPassword: "outra-senha-diferente" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const issue = parsed.error.issues.find((item) => item.message === "As senhas não coincidem.");
    expect(issue?.path).toEqual(["confirmPassword"]);
  });

  it("is required", () => {
    expect(errorFor({ ...VALID, confirmPassword: "" }, "confirmPassword")).toBeTruthy();
  });

  it("is case-sensitive — 'Senha' does not confirm 'senha'", () => {
    const parsed = signupSchema.safeParse({
      ...VALID,
      password: "senha-secreta",
      confirmPassword: "Senha-Secreta",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts an exact match", () => {
    expect(errorFor(VALID, "confirmPassword")).toBeNull();
  });
});

// ------------------------------------------------------------------
// Aceite dos termos
// ------------------------------------------------------------------

describe("aceite dos termos", () => {
  it("rejects an unchecked box WITH an actionable message", () => {
    expect(errorFor({ ...VALID, acceptTerms: false }, "acceptTerms")).toBe(
      "É necessário aceitar os termos para continuar.",
    );
  });

  it("rejects a missing field with the same message", () => {
    const { acceptTerms: _omitted, ...without } = VALID;
    expect(errorFor(without, "acceptTerms")).toBe("É necessário aceitar os termos para continuar.");
  });

  it('rejects the string "true" — only a real boolean counts as consent', () => {
    expect(errorFor({ ...VALID, acceptTerms: "true" }, "acceptTerms")).toBeTruthy();
  });

  it("rejects 1 as a stand-in for true", () => {
    expect(errorFor({ ...VALID, acceptTerms: 1 }, "acceptTerms")).toBeTruthy();
  });

  it("accepts a checked box", () => {
    expect(errorFor(VALID, "acceptTerms")).toBeNull();
  });

  it("is exported standalone for per-field use", () => {
    expect(termsSchema.safeParse(true).success).toBe(true);
    expect(termsSchema.safeParse(false).success).toBe(false);
  });
});

// ------------------------------------------------------------------
// §8 — the error contract itself
// ------------------------------------------------------------------

describe("§8 — every rejection is attributable to a field", () => {
  it("a fully empty submission produces one error PER field, not one banner", () => {
    const parsed = signupSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const fieldErrors = parsed.error.flatten().fieldErrors;
    for (const field of ["name", "company", "whatsapp", "email", "password", "acceptTerms"]) {
      expect(fieldErrors, field).toHaveProperty(field);
    }
  });

  it("no message is the generic 'Revise os campos destacados'", () => {
    const parsed = signupSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    for (const issue of parsed.error.issues) {
      expect(issue.message).not.toMatch(/Revise os campos/i);
    }
  });

  it("every message is a real sentence, not a Zod default", () => {
    const parsed = signupSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    for (const issue of parsed.error.issues) {
      expect(issue.message.length).toBeGreaterThan(8);
      expect(issue.message).not.toMatch(/^(Required|Invalid|Expected)/);
    }
  });

  it("every message is written in Portuguese", () => {
    const parsed = signupSchema.safeParse({ ...VALID, name: "", company: "", whatsapp: "abc" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    for (const issue of parsed.error.issues) {
      expect(issue.message).toMatch(/[çãéêíóú]|\b(Informe|senha|empresa|nome|email|termos)\b/i);
    }
  });

  it("reports MULTIPLE independent problems at once", () => {
    const parsed = signupSchema.safeParse({
      ...VALID,
      name: "",
      company: "",
      whatsapp: "1",
      email: "nope",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const fields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    expect(fields.size).toBeGreaterThanOrEqual(4);
  });

  it("every issue carries a path — an error with no field would be unrenderable", () => {
    const parsed = signupSchema.safeParse({ ...VALID, name: "", confirmPassword: "different-x" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    for (const issue of parsed.error.issues) {
      expect(issue.path.length).toBeGreaterThan(0);
    }
  });
});

// ------------------------------------------------------------------
// `next` — the redirect carried through signup
// ------------------------------------------------------------------

describe("next", () => {
  it("is optional", () => {
    const { next: _omitted, ...without } = VALID;
    expect(signupSchema.safeParse(without).success).toBe(true);
  });

  it("normalizes an absent value to null", () => {
    const { next: _omitted, ...without } = VALID;
    expect(signupSchema.parse(without).next).toBeNull();
  });

  it("passes a plain path through (the route sanitiser is the authority)", () => {
    expect(signupSchema.parse({ ...VALID, next: "/dashboard/products" }).next).toBe(
      "/dashboard/products",
    );
  });

  it("rejects an absurdly long value before it can reach a redirect", () => {
    expect(signupSchema.safeParse({ ...VALID, next: `/${"a".repeat(3000)}` }).success).toBe(false);
  });
});
