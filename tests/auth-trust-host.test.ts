import { describe, expect, it } from "vitest";
import { resolveTrustHost } from "@/lib/auth-trust-host";

/**
 * Regression guard for the production incident:
 *
 *   [auth][error] UntrustedHost: Host must be trusted.
 *   URL was: https://brobond-ai-commerce.onrender.com/api/auth/session
 *
 * Behind Render's proxy the public host arrives in `X-Forwarded-Host`, and
 * Auth.js refuses to use it unless `trustHost` is set. The policy therefore
 * belongs to the configuration, not to a dashboard variable alone.
 */
describe("resolveTrustHost()", () => {
  it("trusts the forwarded host when AUTH_TRUST_HOST is unset (the Render regression)", () => {
    expect(resolveTrustHost({})).toBe(true);
  });

  it("trusts the forwarded host when AUTH_TRUST_HOST=true", () => {
    expect(resolveTrustHost({ AUTH_TRUST_HOST: "true" })).toBe(true);
    expect(resolveTrustHost({ AUTH_TRUST_HOST: " TRUE " })).toBe(true);
    expect(resolveTrustHost({ AUTH_TRUST_HOST: "1" })).toBe(true);
  });

  it("honours an explicit opt-out", () => {
    expect(resolveTrustHost({ AUTH_TRUST_HOST: "false" })).toBe(false);
    expect(resolveTrustHost({ AUTH_TRUST_HOST: "0" })).toBe(false);
    expect(resolveTrustHost({ AUTH_TRUST_HOST: "False" })).toBe(false);
  });
});
