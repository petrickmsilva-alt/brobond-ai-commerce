"use server";

import { randomUUID } from "node:crypto";
import { AuthError } from "next-auth";
import { Prisma } from "@prisma/client";
import { signIn } from "@/lib/auth";
import { resolveNext } from "@/lib/auth-routes";
import { signupSchema } from "@/lib/validations/auth";
import { SignupReadinessError, assertSignupReady } from "@/modules/auth/signup-health.service";
import { asError, logSignupEvent, logSignupFailure } from "@/modules/auth/signup-logging";
import { SignupError, signupService } from "@/modules/auth/signup.service";

/**
 * Public self-signup server action.
 *
 * The action owns the operational boundaries around the transaction:
 * validation → database readiness → atomic provisioning → automatic login.
 * Every failure has a stable code, an explainable message and diagnostic
 * details. The browser gets the actual actionable cause and the server log
 * keeps the original stack trace under the same request id.
 */

export interface SignupFailureDetails {
  /** Correlates the UI error with structured server logs. */
  requestId: string;
  /** Human-readable diagnostic. Never includes the password. */
  reason: string;
  /** Original stacktrace retained for immediate troubleshooting. */
  stack?: string;
}

export type SignupActionErrorCode =
  | "VALIDATION_ERROR"
  | "EMAIL_ALREADY_EXISTS"
  | "PRISMA_UNAVAILABLE"
  | "MIGRATION_PENDING"
  | "SCHEMA_INCOMPLETE"
  | "DATABASE_CONSTRAINT"
  | "AUTO_LOGIN_FAILED"
  | "SIGNUP_FAILED";

export type SignupActionResult =
  | { ok: true; redirectTo: string }
  | {
      ok: false;
      code: SignupActionErrorCode;
      message: string;
      details: SignupFailureDetails;
      fieldErrors?: Record<string, string[]>;
    };

const EMAIL_TAKEN = "Este email já possui uma conta.";

export async function signupAction(input: unknown): Promise<SignupActionResult> {
  const requestId = randomUUID();
  const parsed = signupSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
    const message = firstMessage(fieldErrors) ?? "Há dados obrigatórios ausentes no cadastro.";

    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message,
      details: { requestId, reason: message },
      fieldErrors,
    };
  }

  const data = parsed.data;
  // Resolve before a session cookie is minted so untrusted `next` never
  // returns from this action unchanged.
  const redirectTo = resolveNext(data.next);
  let stage = "HEALTHCHECK";
  let accountCreated = false;

  try {
    logSignupEvent("SIGNUP_START", { requestId, stage });

    // Verifies Prisma connectivity, migration metadata and both required
    // tables before any Organization/User write is attempted.
    await assertSignupReady();

    stage = "PROVISIONING";
    await signupService.register(data, { requestId });
    accountCreated = true;

    stage = "LOGIN";
    await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });

    logSignupEvent("LOGIN_SUCCESS", { requestId, stage, code: "SIGNUP_SUCCESS" });
    return { ok: true, redirectTo };
  } catch (error) {
    // Keep the original object (and its native stack) in the server log. The
    // ActionResult below exposes the same diagnostic in a serializable shape
    // for the technical details panel in the signup UI.
    logSignupFailure(error, { requestId, stage });
    return toSignupActionFailure(error, { requestId, accountCreated });
  }
}

function toSignupActionFailure(
  error: unknown,
  context: { requestId: string; accountCreated: boolean },
): Extract<SignupActionResult, { ok: false }> {
  if (error instanceof SignupError && error.code === "EMAIL_TAKEN") {
    return failure("EMAIL_ALREADY_EXISTS", EMAIL_TAKEN, error, context, {
      fieldErrors: { email: [EMAIL_TAKEN] },
    });
  }

  if (error instanceof SignupReadinessError) {
    // The readiness wrapper supplies a friendly code/message, while its cause
    // preserves the original Prisma/PostgreSQL stack in `details.stack`.
    return failure(error.code, error.message, error.cause ?? error, context, {
      reason: error.details,
    });
  }

  // A unique email index decides the race between concurrent signup requests.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    if (isEmailConstraint(error)) {
      return failure("EMAIL_ALREADY_EXISTS", EMAIL_TAKEN, error, context, {
        fieldErrors: { email: [EMAIL_TAKEN] },
      });
    }

    return failure(
      "DATABASE_CONSTRAINT",
      `O banco de dados rejeitou uma informação do cadastro: ${error.message}`,
      error,
      context,
    );
  }

  // These errors can only occur when the generated Prisma client and deployed
  // schema disagree. Surface that exact deployment fault instead of masking it
  // as an account-creation failure.
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  ) {
    return failure(
      "SCHEMA_INCOMPLETE",
      "A estrutura do banco de dados do cadastro está incompleta. Aplique as migrations pendentes.",
      error,
      context,
    );
  }

  if (error instanceof AuthError) {
    const message = context.accountCreated
      ? "Sua conta foi criada, mas o login automático falhou. Faça login com o email e a senha informados."
      : "O login automático falhou antes de concluir o cadastro.";
    return failure("AUTO_LOGIN_FAILED", message, error, context);
  }

  const original = asError(error);
  return failure(
    "SIGNUP_FAILED",
    original.message.trim() || "O cadastro falhou sem uma mensagem de diagnóstico.",
    original,
    context,
  );
}

function failure(
  code: SignupActionErrorCode,
  message: string,
  error: unknown,
  context: { requestId: string; accountCreated: boolean },
  options: { fieldErrors?: Record<string, string[]>; reason?: string } = {},
): Extract<SignupActionResult, { ok: false }> {
  const original = asError(error);
  const reason = options.reason ?? original.message ?? message;

  return {
    ok: false,
    code,
    message,
    details: {
      requestId: context.requestId,
      reason,
      stack: original.stack,
    },
    ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
  };
}

function isEmailConstraint(error: Prisma.PrismaClientKnownRequestError): boolean {
  const target = error.meta?.target;
  const values = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  // PostgreSQL can report either a field (`email`) or its named unique index.
  return values.some((value) => /email/i.test(String(value)));
}

/** The first concrete field message is also the accessible summary. */
function firstMessage(fieldErrors: Record<string, string[]>): string | null {
  for (const messages of Object.values(fieldErrors)) {
    const message = messages?.[0];
    if (message) return message;
  }
  return null;
}
