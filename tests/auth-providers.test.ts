import { describe, expect, it } from "vitest";
import {
  GOOGLE_ENV_KEYS,
  getAvailableProviders,
  isGoogleProviderConfigured,
  showGoogleProvider,
  type ProviderEnv,
} from "@/lib/auth-providers";

/**
 * PR010.2 §4 — Google provider visibility.
 *
 * THE RULE: "Nunca deixar botão desabilitado." The button is rendered only
 * when the provider is genuinely usable, and hidden entirely otherwise.
 *
 * These tests inject an environment object rather than mutating
 * `process.env`, so they are order-independent and leak nothing between runs.
 */

const CONFIGURED: ProviderEnv = {
  AUTH_GOOGLE_ID: "1234567890-abcdef.apps.googleusercontent.com",
  AUTH_GOOGLE_SECRET: "GOCSPX-fake-secret-for-tests",
};

describe("isGoogleProviderConfigured()", () => {
  it("is true only when BOTH the id and the secret are present", () => {
    expect(isGoogleProviderConfigured(CONFIGURED)).toBe(true);
  });

  it("is false when nothing is configured", () => {
    expect(isGoogleProviderConfigured({})).toBe(false);
  });

  it("is false when only the client id is present", () => {
    // A half-configured provider would render a button that dies at the
    // callback — exactly the broken promise §4 removes.
    expect(isGoogleProviderConfigured({ AUTH_GOOGLE_ID: CONFIGURED.AUTH_GOOGLE_ID })).toBe(false);
  });

  it("is false when only the client secret is present", () => {
    expect(isGoogleProviderConfigured({ AUTH_GOOGLE_SECRET: CONFIGURED.AUTH_GOOGLE_SECRET })).toBe(
      false,
    );
  });

  it("treats blank and whitespace-only values as absent", () => {
    expect(isGoogleProviderConfigured({ AUTH_GOOGLE_ID: "", AUTH_GOOGLE_SECRET: "" })).toBe(false);
    expect(isGoogleProviderConfigured({ AUTH_GOOGLE_ID: "   ", AUTH_GOOGLE_SECRET: "   " })).toBe(
      false,
    );
    expect(
      isGoogleProviderConfigured({ AUTH_GOOGLE_ID: "\n\t", AUTH_GOOGLE_SECRET: "valid" }),
    ).toBe(false);
  });

  it("treats explicitly undefined values as absent", () => {
    expect(
      isGoogleProviderConfigured({ AUTH_GOOGLE_ID: undefined, AUTH_GOOGLE_SECRET: undefined }),
    ).toBe(false);
  });

  it("documents exactly which variables enable the provider", () => {
    // PR010.3 §12 adds the GOOGLE_CLIENT_* aliases to the PR010.2 pair.
    expect(GOOGLE_ENV_KEYS).toEqual([
      "AUTH_GOOGLE_ID",
      "AUTH_GOOGLE_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ]);
  });
});

describe("showGoogleProvider()", () => {
  it("mirrors isGoogleProviderConfigured() — UI and auth config cannot drift", () => {
    // If these two ever disagree, the UI shows a button pointing at a 404.
    const environments: ProviderEnv[] = [
      {},
      CONFIGURED,
      { AUTH_GOOGLE_ID: "id" },
      { AUTH_GOOGLE_SECRET: "secret" },
      { AUTH_GOOGLE_ID: " ", AUTH_GOOGLE_SECRET: "secret" },
    ];

    for (const env of environments) {
      expect(showGoogleProvider(env)).toBe(isGoogleProviderConfigured(env));
    }
  });

  it("hides the button when the provider is not provisioned", () => {
    expect(showGoogleProvider({})).toBe(false);
  });

  it("shows the button when the provider is provisioned", () => {
    expect(showGoogleProvider(CONFIGURED)).toBe(true);
  });
});

describe("getAvailableProviders()", () => {
  it("always reports credentials as available", () => {
    expect(getAvailableProviders({}).credentials).toBe(true);
    expect(getAvailableProviders(CONFIGURED).credentials).toBe(true);
  });

  it("reflects Google availability", () => {
    expect(getAvailableProviders({}).google).toBe(false);
    expect(getAvailableProviders(CONFIGURED).google).toBe(true);
  });

  it("NEVER leaks the client id or secret into the payload", () => {
    // This object is serialized into a Client Component. A regression here
    // would ship an OAuth secret to every browser.
    const snapshot = getAvailableProviders(CONFIGURED);
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain(CONFIGURED.AUTH_GOOGLE_ID as string);
    expect(serialized).not.toContain(CONFIGURED.AUTH_GOOGLE_SECRET as string);
    expect(serialized).not.toContain("GOCSPX");
    expect(Object.keys(snapshot).sort()).toEqual(["credentials", "google"]);
  });

  it("returns booleans only", () => {
    const snapshot = getAvailableProviders(CONFIGURED);
    for (const value of Object.values(snapshot)) {
      expect(typeof value).toBe("boolean");
    }
  });
});
