import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAvailableProviders,
  isGoogleProviderConfigured,
  resolveGoogleCredentials,
  showGoogleProvider,
  type ProviderEnv,
} from "@/lib/auth-providers";

/**
 * PR010.3 §5/§12 — Google login visibility across BOTH env conventions.
 *
 * THE RULE (unchanged from PR010.2): "Se variáveis existirem: mostrar botão.
 * Caso contrário: ocultar botão. Nunca deixar desabilitado."
 *
 * PR010.3 §12 adds `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as aliases of
 * the NextAuth-native `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. These tests pin
 * the pair semantics (a pair counts only when complete), the precedence, and
 * the source contracts that keep the button and the provider registration
 * from drifting.
 */

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/** Source with comments stripped — these files document the rule in prose. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const AUTH_PAIR: ProviderEnv = {
  AUTH_GOOGLE_ID: "1234567890-auth.apps.googleusercontent.com",
  AUTH_GOOGLE_SECRET: "GOCSPX-auth-secret",
};

const SPEC_PAIR: ProviderEnv = {
  GOOGLE_CLIENT_ID: "1234567890-spec.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-spec-secret",
};

describe("resolveGoogleCredentials() — the §12 alias pairs", () => {
  it("resolves the AUTH_GOOGLE_* pair (NextAuth native, PR010.2)", () => {
    expect(resolveGoogleCredentials(AUTH_PAIR)).toEqual({
      clientId: AUTH_PAIR.AUTH_GOOGLE_ID,
      clientSecret: AUTH_PAIR.AUTH_GOOGLE_SECRET,
    });
  });

  it("resolves the GOOGLE_CLIENT_* pair (PR010.3 §12 alias)", () => {
    expect(resolveGoogleCredentials(SPEC_PAIR)).toEqual({
      clientId: SPEC_PAIR.GOOGLE_CLIENT_ID,
      clientSecret: SPEC_PAIR.GOOGLE_CLIENT_SECRET,
    });
  });

  it("returns null when nothing is configured", () => {
    expect(resolveGoogleCredentials({})).toBeNull();
  });

  it("prefers the AUTH_GOOGLE_* pair when both pairs are complete", () => {
    expect(resolveGoogleCredentials({ ...AUTH_PAIR, ...SPEC_PAIR })).toEqual({
      clientId: AUTH_PAIR.AUTH_GOOGLE_ID,
      clientSecret: AUTH_PAIR.AUTH_GOOGLE_SECRET,
    });
  });

  it("falls back to the GOOGLE_CLIENT_* pair when only it is complete", () => {
    const env = { ...SPEC_PAIR, AUTH_GOOGLE_ID: "half" };
    expect(resolveGoogleCredentials(env)).toEqual({
      clientId: SPEC_PAIR.GOOGLE_CLIENT_ID,
      clientSecret: SPEC_PAIR.GOOGLE_CLIENT_SECRET,
    });
  });

  it("does NOT mix one variable from each pair", () => {
    // A half-configured provider would render a button that dies at the
    // callback — the exact broken promise §5 forbids.
    expect(resolveGoogleCredentials({ GOOGLE_CLIENT_ID: "a", AUTH_GOOGLE_SECRET: "b" })).toBeNull();
    expect(resolveGoogleCredentials({ AUTH_GOOGLE_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toBeNull();
  });

  it("treats blank values as absent", () => {
    expect(resolveGoogleCredentials({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" })).toBeNull();
    expect(
      resolveGoogleCredentials({ GOOGLE_CLIENT_ID: "   ", GOOGLE_CLIENT_SECRET: "valid" }),
    ).toBeNull();
  });

  it("treats explicitly undefined values as absent", () => {
    expect(
      resolveGoogleCredentials({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined }),
    ).toBeNull();
  });

  it("trims the resolved values", () => {
    expect(
      resolveGoogleCredentials({ GOOGLE_CLIENT_ID: "  id-value  ", GOOGLE_CLIENT_SECRET: " s " }),
    ).toEqual({ clientId: "id-value", clientSecret: "s" });
  });
});

describe("isGoogleProviderConfigured() — with the aliases", () => {
  it("is true for a complete AUTH_GOOGLE_* pair", () => {
    expect(isGoogleProviderConfigured(AUTH_PAIR)).toBe(true);
  });

  it("is true for a complete GOOGLE_CLIENT_* pair", () => {
    expect(isGoogleProviderConfigured(SPEC_PAIR)).toBe(true);
  });

  it("is false when only GOOGLE_CLIENT_ID is present", () => {
    expect(isGoogleProviderConfigured({ GOOGLE_CLIENT_ID: "id" })).toBe(false);
  });

  it("is false when only GOOGLE_CLIENT_SECRET is present", () => {
    expect(isGoogleProviderConfigured({ GOOGLE_CLIENT_SECRET: "secret" })).toBe(false);
  });

  it("mirrors resolveGoogleCredentials() for a matrix of environments", () => {
    const environments: ProviderEnv[] = [
      {},
      AUTH_PAIR,
      SPEC_PAIR,
      { GOOGLE_CLIENT_ID: "id" },
      { GOOGLE_CLIENT_SECRET: "s" },
      { GOOGLE_CLIENT_ID: "id", AUTH_GOOGLE_SECRET: "s" },
      { AUTH_GOOGLE_ID: " ", GOOGLE_CLIENT_SECRET: "s" },
      { ...AUTH_PAIR, ...SPEC_PAIR },
    ];
    for (const env of environments) {
      expect(isGoogleProviderConfigured(env)).toBe(resolveGoogleCredentials(env) !== null);
    }
  });
});

describe("showGoogleProvider() — the UI predicate", () => {
  it("shows the button when the spec pair is configured", () => {
    expect(showGoogleProvider(SPEC_PAIR)).toBe(true);
  });

  it("hides the button when no complete pair exists", () => {
    expect(showGoogleProvider({ GOOGLE_CLIENT_ID: "id", AUTH_GOOGLE_SECRET: "s" })).toBe(false);
  });

  it("mirrors isGoogleProviderConfigured() — UI and auth config cannot drift", () => {
    for (const env of [{}, AUTH_PAIR, SPEC_PAIR, { GOOGLE_CLIENT_ID: "x" }] as ProviderEnv[]) {
      expect(showGoogleProvider(env)).toBe(isGoogleProviderConfigured(env));
    }
  });

  it("getAvailableProviders() reflects the alias pair without leaking it", () => {
    const snapshot = getAvailableProviders(SPEC_PAIR);
    expect(snapshot.google).toBe(true);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(SPEC_PAIR.GOOGLE_CLIENT_ID as string);
    expect(serialized).not.toContain(SPEC_PAIR.GOOGLE_CLIENT_SECRET as string);
    expect(serialized).not.toContain("GOCSPX");
  });
});

describe("source contracts — the wiring cannot drift", () => {
  it("lib/auth.ts resolves the provider credentials through the shared resolver", () => {
    const source = read("lib/auth.ts");
    expect(source).toContain("resolveGoogleCredentials");
    expect(source).toContain("isGoogleProviderConfigured");
  });

  it("lib/auth.ts no longer reads the env variables directly", () => {
    const source = read("lib/auth.ts");
    expect(source).not.toContain("process.env.AUTH_GOOGLE_ID");
    expect(source).not.toContain("process.env.GOOGLE_CLIENT_ID");
  });

  it("the login page still derives visibility from showGoogleProvider()", () => {
    expect(read("app/login/page.tsx")).toContain("showGoogleProvider");
  });

  it("the SSO button still renders nothing (never disabled) when absent", () => {
    const source = read("components/auth/sso-buttons.tsx");
    expect(source).toMatch(/if \(!google\) return null;/);
    // Checked against the comment-stripped source — the file explains the
    // rule in prose.
    expect(code("components/auth/sso-buttons.tsx")).not.toContain("disabled");
  });

  it("the sso button never receives credentials (boolean only)", () => {
    const source = read("components/auth/sso-buttons.tsx");
    expect(source).toMatch(/google: boolean/);
    expect(source).not.toContain("GOOGLE_CLIENT_ID");
    expect(source).not.toContain("GOOGLE_CLIENT_SECRET");
  });

  it("lib/env.ts documents and validates the alias variables", () => {
    const source = read("lib/env.ts");
    expect(source).toContain("GOOGLE_CLIENT_ID");
    expect(source).toContain("GOOGLE_CLIENT_SECRET");
    expect(source).toContain("APP_URL");
  });

  it(".env.example documents both pairs and APP_URL", () => {
    const example = read(".env.example");
    for (const key of [
      "AUTH_GOOGLE_ID=",
      "AUTH_GOOGLE_SECRET=",
      "GOOGLE_CLIENT_ID=",
      "GOOGLE_CLIENT_SECRET=",
      "APP_URL=",
    ]) {
      expect(example).toContain(key);
    }
  });
});
