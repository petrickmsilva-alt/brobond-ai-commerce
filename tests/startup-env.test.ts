import { describe, expect, it } from "vitest";
import { validateStartupEnvironment } from "@/lib/env";

const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db.internal:5432/brobond",
  AUTH_SECRET: "a-production-secret",
  NEXTAUTH_URL: "https://brobond-ai-commerce.onrender.com",
};

describe("startup environment validation", () => {
  it("accepts all mandatory Render variables", () => {
    expect(validateStartupEnvironment(VALID_ENV)).toMatchObject(VALID_ENV);
  });

  it("fails startup when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _missing, ...withoutDatabase } = VALID_ENV;

    expect(() => validateStartupEnvironment(withoutDatabase)).toThrow(/DATABASE_URL is required/);
  });

  it("also requires AUTH_SECRET and NEXTAUTH_URL", () => {
    expect(() =>
      validateStartupEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: VALID_ENV.DATABASE_URL,
      }),
    ).toThrow(/AUTH_SECRET is required/);

    expect(() =>
      validateStartupEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: VALID_ENV.DATABASE_URL,
        AUTH_SECRET: VALID_ENV.AUTH_SECRET,
      }),
    ).toThrow(/NEXTAUTH_URL is required/);
  });
});
