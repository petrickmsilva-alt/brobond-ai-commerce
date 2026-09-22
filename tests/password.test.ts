import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

/**
 * Passwords are stored ONLY as a bcrypt digest — never in plaintext.
 */
describe("password hashing", () => {
  const plain = "Sup3rS3cret!2026";

  it("produces a bcrypt digest that does not contain the plaintext", async () => {
    const hash = await hashPassword(plain);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(hash).not.toContain(plain);
    expect(hash.length).toBeGreaterThan(50);
  });

  it("is salted — the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword(plain), hashPassword(plain)]);
    expect(a).not.toBe(b);
  });

  it("verifies the correct password and rejects wrong ones", async () => {
    const hash = await hashPassword(plain);
    await expect(verifyPassword(plain, hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("rejects empty input and malformed hashes without throwing", async () => {
    const hash = await hashPassword(plain);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
    await expect(verifyPassword(plain, "")).resolves.toBe(false);
    await expect(verifyPassword(plain, "not-a-bcrypt-hash")).resolves.toBe(false);
  });

  it("refuses to hash an empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});
