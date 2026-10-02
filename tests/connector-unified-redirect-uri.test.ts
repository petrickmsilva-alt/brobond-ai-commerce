import { describe, expect, it } from "vitest";

/**
 * PR016.2 — the unified ecosystem redirect URI binding.
 *
 * The director pinned the ecosystem's unified callback on Render under the
 * name `MERCADOPAGO_REDIRECT_URI`; the Mercado Livre application already
 * knew it as `MERCADOLIVRE_REDIRECT_URI`. The connector configuration
 * service (`modules/connectors/core/connector.service.ts`) accepts BOTH and
 * resolves ONE static value — the same constant the authorization URL and
 * the financial-flow token exchange replay. There is no request parameter
 * to pass (the compiler enforces it): nothing may ever be derived from
 * request headers again.
 */

import {
  listUnifiedRedirectUriCandidates,
  resolveUnifiedRedirectUri,
  UNIFIED_CALLBACK_PATH,
  UNIFIED_REDIRECT_URI_ENV_KEYS,
} from "@/modules/connectors/core/connector.service";
import { MERCADOLIVRE_CALLBACK_PATH } from "@/modules/marketplace/mercadolivre/mercadolivre.service";

const RENDER_URL = "https://brobond-ai-commerce.onrender.com";
const PINNED_URI = "https://app.example.com/api/mercadolivre/callback";

describe("unified ecosystem callback binding", () => {
  it("exposes ONE canonical handler path shared by the whole ecosystem", () => {
    expect(UNIFIED_CALLBACK_PATH).toBe("/api/mercadolivre/callback");
    // The Mercado Livre service re-exports the same constant — the two
    // modules can never drift apart.
    expect(MERCADOLIVRE_CALLBACK_PATH).toBe(UNIFIED_CALLBACK_PATH);
  });

  it("accepts both MERCADOLIVRE_REDIRECT_URI and MERCADOPAGO_REDIRECT_URI", () => {
    expect([...UNIFIED_REDIRECT_URI_ENV_KEYS]).toEqual([
      "MERCADOLIVRE_REDIRECT_URI",
      "MERCADOPAGO_REDIRECT_URI",
    ]);
  });
});

describe("resolveUnifiedRedirectUri()", () => {
  it("resolves the operator's MERCADOPAGO_REDIRECT_URI pin (the Render variable)", () => {
    expect(
      resolveUnifiedRedirectUri({
        MERCADOPAGO_REDIRECT_URI: PINNED_URI,
        APP_URL: "https://app.brobond.ai",
        NEXTAUTH_URL: RENDER_URL,
      }),
    ).toBe(PINNED_URI);
  });

  it("resolves MERCADOLIVRE_REDIRECT_URI equally — same handler, legacy name", () => {
    expect(
      resolveUnifiedRedirectUri({
        MERCADOLIVRE_REDIRECT_URI: PINNED_URI,
        APP_URL: "https://app.brobond.ai",
      }),
    ).toBe(PINNED_URI);
  });

  it("prefers the Mercado Livre name when both ecosystem variables are set", () => {
    expect(
      resolveUnifiedRedirectUri({
        MERCADOLIVRE_REDIRECT_URI: "https://meli.example.com/api/mercadolivre/callback",
        MERCADOPAGO_REDIRECT_URI: "https://mp.example.com/api/mercadolivre/callback",
      }),
    ).toBe("https://meli.example.com/api/mercadolivre/callback");
  });

  it("falls back to APP_URL, then NEXTAUTH_URL, then the local dev base", () => {
    expect(resolveUnifiedRedirectUri({ APP_URL: "https://app.brobond.ai" })).toBe(
      "https://app.brobond.ai/api/mercadolivre/callback",
    );
    expect(resolveUnifiedRedirectUri({ NEXTAUTH_URL: RENDER_URL })).toBe(
      `${RENDER_URL}/api/mercadolivre/callback`,
    );
    expect(resolveUnifiedRedirectUri({})).toBe("http://localhost:3000/api/mercadolivre/callback");
  });

  it("normalizes copied whitespace and trailing slashes", () => {
    expect(
      resolveUnifiedRedirectUri({
        MERCADOPAGO_REDIRECT_URI: `  ${PINNED_URI}/  `,
      }),
    ).toBe(PINNED_URI);
  });

  it("ignores values that are not absolute http(s) URIs", () => {
    expect(
      resolveUnifiedRedirectUri({
        MERCADOPAGO_REDIRECT_URI: "not-a-uri",
        NEXTAUTH_URL: RENDER_URL,
      }),
    ).toBe(`${RENDER_URL}/api/mercadolivre/callback`);
  });
});

describe("listUnifiedRedirectUriCandidates()", () => {
  it("lists every STATIC candidate in precedence order, de-duplicated", () => {
    expect(
      listUnifiedRedirectUriCandidates({
        MERCADOPAGO_REDIRECT_URI: PINNED_URI,
        APP_URL: "https://app.brobond.ai",
        NEXTAUTH_URL: "https://app.brobond.ai/",
      }),
    ).toEqual([
      PINNED_URI,
      "https://app.brobond.ai/api/mercadolivre/callback",
      "http://localhost:3000/api/mercadolivre/callback",
    ]);
  });

  it("collapses identical values across the two ecosystem names", () => {
    const candidates = listUnifiedRedirectUriCandidates({
      MERCADOLIVRE_REDIRECT_URI: PINNED_URI,
      MERCADOPAGO_REDIRECT_URI: PINNED_URI,
      APP_URL: "app.example.com",
      NEXTAUTH_URL: "app.example.com",
    });
    expect(candidates.filter((uri) => uri === PINNED_URI)).toHaveLength(1);
  });

  it("never proposes an unroutable host, even with nothing configured", () => {
    const candidates = listUnifiedRedirectUriCandidates({});
    expect(candidates.every((uri) => !uri.includes("0.0.0.0"))).toBe(true);
    expect(candidates).toEqual(["http://localhost:3000/api/mercadolivre/callback"]);
  });
});
