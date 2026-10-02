import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR016.2 — Mercado Livre OAuth PKCE (RFC 7636).
 *
 * THE PRODUCTION BUG
 * ------------------
 * Mercado Pago conectava e Mercado Livre não. Os aplicativos criados no
 * DevCenter unificado (Mercado Livre + Mercado Pago) saem com o fluxo PKCE
 * HABILITADO — e a documentação oficial é explícita: habilitado o PKCE,
 * `code_challenge`/`code_verifier` tornam-se OBRIGATÓRIOS. A troca do código
 * morria com HTTP 400 `invalid_request: "code_verifier is a required
 * parameter"`, erro que a recuperação de `redirect_uri` (PR016.1) tentava
 * "consertar" reenviando o MESMO request inválido contra outros candidatos —
 * loop infinito de reconexão. O Mercado Pago nunca passava por isso porque
 * conecta colando credenciais, sem OAuth.
 *
 * These tests pin the fix: the pair is generated per attempt, the challenge
 * opens the authorization, the verifier is persisted encrypted with the
 * one-time state and replayed verbatim on the exchange — and a malformed
 * request (`invalid_request`) no longer burns redirect_uri candidates.
 */

import { ConnectorReauthRequiredError, ProviderApiError } from "@/modules/marketplace/core/errors";
import {
  ConnectorOAuthStateError,
  createConnectorOAuthStateService,
} from "@/modules/marketplace/core/oauth-state.service";
import {
  buildMercadoLivreAuthorizationUrl,
  exchangeMercadoLivreCode,
  generateMercadoLivrePkcePair,
} from "@/modules/marketplace/mercadolivre/mercadolivre.service";

const CONFIG = {
  clientId: "2226376717837222",
  clientSecret: "super-secret",
  apiBaseUrl: "https://api.mercadolibre.com",
  authBaseUrl: "https://auth.mercadolivre.com.br",
};

const RENDER_CALLBACK = "https://brobond-ai-commerce.onrender.com/api/mercadolivre/callback";

/** Valid CONNECTOR_ENCRYPTION_KEY fixture (32 bytes as 64 hex chars). */
const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.APP_URL;
  delete process.env.MERCADOLIVRE_REDIRECT_URI;
  process.env.NEXTAUTH_URL = ORIGINAL_ENV.NEXTAUTH_URL;
  process.env.CONNECTOR_ENCRYPTION_KEY = ENCRYPTION_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------
// 1. RFC 7636 key generation
// ------------------------------------------------------------------

describe("generateMercadoLivrePkcePair()", () => {
  it("emits a verifier inside the RFC 7636 bounds and alphabet", () => {
    const { codeVerifier } = generateMercadoLivrePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("derives the challenge as base64url(SHA-256(verifier)) — the S256 method", () => {
    const { codeVerifier, codeChallenge } = generateMercadoLivrePkcePair();
    const expected = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
    expect(codeChallenge).toBe(expected);
  });

  it("never repeats a pair across attempts", () => {
    const first = generateMercadoLivrePkcePair();
    const second = generateMercadoLivrePkcePair();
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
    expect(first.codeChallenge).not.toBe(second.codeChallenge);
  });
});

// ------------------------------------------------------------------
// 2. Authorization URL carries the challenge
// ------------------------------------------------------------------

describe("buildMercadoLivreAuthorizationUrl() — PKCE challenge", () => {
  it("appends code_challenge and code_challenge_method=S256 when PKCE is issued", () => {
    const pkce = generateMercadoLivrePkcePair();
    const url = new URL(
      buildMercadoLivreAuthorizationUrl("state-123", CONFIG, undefined, {
        codeChallenge: pkce.codeChallenge,
      }),
    );

    expect(url.searchParams.get("code_challenge")).toBe(pkce.codeChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // The SECRET verifier never travels on the authorization redirect.
    expect(url.searchParams.has("code_verifier")).toBe(false);
    expect(url.toString()).not.toContain(pkce.codeVerifier);
  });

  it("keeps the strict parameter set when no PKCE pair was issued (legacy states)", () => {
    const url = new URL(buildMercadoLivreAuthorizationUrl("state-123", CONFIG));
    expect([...url.searchParams.keys()].sort()).toEqual(
      ["client_id", "redirect_uri", "response_type", "state"].sort(),
    );
  });
});

// ------------------------------------------------------------------
// 3. Token exchange replays the verifier
// ------------------------------------------------------------------

describe("exchangeMercadoLivreCode() — PKCE verifier", () => {
  const tokenPayload = {
    access_token: "APP_USR-access",
    refresh_token: "TG-refresh",
    expires_in: 21_600,
    user_id: 987,
  };

  it("sends code_verifier on the authorization_code grant when provided", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(tokenPayload));

    await exchangeMercadoLivreCode("TG-code", CONFIG, {
      redirectUris: [RENDER_CALLBACK],
      codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    });

    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  });

  it("omits code_verifier for pre-PKCE states instead of sending an empty one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(tokenPayload));

    await exchangeMercadoLivreCode("TG-code", CONFIG, { redirectUris: [RENDER_CALLBACK] });

    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.has("code_verifier")).toBe(false);
  });

  it("does not waste redirect_uri candidates on a code_verifier rejection (invalid_request)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          error: "invalid_request",
          error_description: "code_verifier is a required parameter",
        },
        400,
      ),
    );

    const error = await exchangeMercadoLivreCode("TG-code", CONFIG, {
      redirectUris: ["https://a.example.com/cb", "https://b.example.com/cb"],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderApiError);
    // ONE attempt only: the request is malformed for every candidate.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still tries the next candidate on a genuine redirect_uri mismatch (invalid_grant)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400))
      .mockResolvedValueOnce(jsonResponse(tokenPayload));

    const tokens = await exchangeMercadoLivreCode("TG-code", CONFIG, {
      redirectUris: ["https://stale.example.com/cb", RENDER_CALLBACK],
      codeVerifier: "verifier-123",
    });

    expect(tokens.accessToken).toBe("APP_USR-access");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------------
// 4. OAuth state binds the verifier (encrypted) to the one-time state
// ------------------------------------------------------------------

interface StoredStateRow {
  id: string;
  organizationId: string;
  provider: string;
  stateHash: string;
  codeVerifier: string | null;
  expiresAt: Date;
}

/** Minimal in-memory stand-in for the ConnectorOAuthState delegate. */
function fakeStateDb() {
  const rows: StoredStateRow[] = [];
  let sequence = 0;
  return {
    rows,
    connectorOAuthState: {
      async deleteMany({ where }: { where: Record<string, unknown> }) {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index]!;
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.provider !== undefined && row.provider !== where.provider) continue;
          if (where.organizationId !== undefined && row.organizationId !== where.organizationId)
            continue;
          const expiry = where.expiresAt as { lte?: Date; gt?: Date } | undefined;
          if (expiry?.lte !== undefined && row.expiresAt > expiry.lte) continue;
          if (expiry?.gt !== undefined && row.expiresAt <= expiry.gt) continue;
          rows.splice(index, 1);
        }
        return { count: before - rows.length };
      },
      async create({ data }: { data: Omit<StoredStateRow, "id"> }) {
        sequence += 1;
        const row = { ...data, id: `state-${sequence}` };
        rows.push(row);
        return row;
      },
      async findUnique({ where }: { where: { stateHash: string } }) {
        return rows.find((row) => row.stateHash === where.stateHash) ?? null;
      },
    },
  };
}

describe("connectorOAuthStateService — PKCE verifier lifecycle", () => {
  it("round-trips the verifier: issued plaintext, encrypted at rest, decrypted on consume", async () => {
    const db = fakeStateDb();
    const service = createConnectorOAuthStateService(db as never, {
      randomState: () => "random-state-value-0123456789",
    });

    const issued = await service.issue("org-1", "MERCADOLIVRE", {
      codeVerifier: "verifier-plaintext-43chars-minimum-01234567890123",
    });
    expect(issued.state).toBe("random-state-value-0123456789");
    expect(issued.codeVerifier).toBe("verifier-plaintext-43chars-minimum-01234567890123");

    // At rest: a versioned AES-256-GCM ciphertext, never the plaintext.
    const stored = db.rows[0]!;
    expect(stored.codeVerifier).not.toBeNull();
    expect(stored.codeVerifier).not.toContain("verifier-plaintext-43chars-minimum-01234567890123");
    expect(stored.codeVerifier).toMatch(/^v1\./);

    const consumed = await service.consume(issued.state, "MERCADOLIVRE");
    expect(consumed.organizationId).toBe("org-1");
    expect(consumed.codeVerifier).toBe("verifier-plaintext-43chars-minimum-01234567890123");
    // Single-use: the second consume sees nothing.
    await expect(service.consume(issued.state, "MERCADOLIVRE")).rejects.toBeInstanceOf(
      ConnectorOAuthStateError,
    );
  });

  it("keeps states issued without a verifier consumable (Shopee / legacy rows)", async () => {
    const db = fakeStateDb();
    const service = createConnectorOAuthStateService(db as never, {
      randomState: () => "legacy-state-0123456789",
    });

    const issued = await service.issue("org-1", "SHOPEE");
    expect(issued.codeVerifier).toBeUndefined();
    // No ciphertext is written for a flow that has no verifier (Prisma
    // persists the missing column as NULL).
    expect(db.rows[0]!.codeVerifier ?? null).toBeNull();

    const consumed = await service.consume(issued.state, "SHOPEE");
    expect(consumed.organizationId).toBe("org-1");
    expect(consumed.codeVerifier).toBeUndefined();
  });

  it("fails closed when the verifier can no longer be decrypted (key rotated mid-flow)", async () => {
    const db = fakeStateDb();
    const service = createConnectorOAuthStateService(db as never, {
      randomState: () => "rotated-key-state-0123456",
    });

    const issued = await service.issue("org-1", "MERCADOLIVRE", { codeVerifier: "v".repeat(43) });
    process.env.CONNECTOR_ENCRYPTION_KEY = "f".repeat(64);

    await expect(service.consume(issued.state, "MERCADOLIVRE")).rejects.toBeInstanceOf(
      ConnectorOAuthStateError,
    );
  });
});

// ------------------------------------------------------------------
// 5. Regression: reauth contract unchanged by the new error metadata
// ------------------------------------------------------------------

describe("PKCE rejection still resolves to the reconnect action", () => {
  it("flags a 400 invalid_request on the exchange as requiresReauth", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          error: "invalid_request",
          error_description: "code_verifier is a required parameter",
        },
        400,
      ),
    );

    const error = await exchangeMercadoLivreCode("TG-code", CONFIG, {
      redirectUris: [RENDER_CALLBACK],
    }).catch((caught: unknown) => caught);

    // 4xx ≠ outage: only authorizing again (now WITH PKCE) fixes it.
    expect((error as ProviderApiError).requiresReauth).toBe(true);
    expect(error).not.toBeInstanceOf(ConnectorReauthRequiredError);
  });
});
