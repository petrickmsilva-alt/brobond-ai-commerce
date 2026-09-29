import { describe, expect, it } from "vitest";
import {
  ALLOWED_CONTENT_TYPES,
  assertUploadAllowed,
  getMediaStorage,
  MAX_UPLOAD_BYTES,
  MediaStorageNotConfiguredError,
} from "@/modules/commerce/products/services/media-storage";

describe("media-storage — upload policy (interface prepared)", () => {
  it("accepts allowed image types within the size limit", () => {
    for (const contentType of ALLOWED_CONTENT_TYPES) {
      expect(() => assertUploadAllowed({ contentType, size: 1024 })).not.toThrow();
    }
  });

  it("rejects disallowed content types", () => {
    expect(() =>
      assertUploadAllowed({ contentType: "application/x-msdownload", size: 10 }),
    ).toThrow();
    expect(() => assertUploadAllowed({ contentType: "text/html", size: 10 })).toThrow();
  });

  it("rejects empty and oversized files", () => {
    expect(() => assertUploadAllowed({ contentType: "image/png", size: 0 })).toThrow();
    expect(() =>
      assertUploadAllowed({ contentType: "image/png", size: MAX_UPLOAD_BYTES + 1 }),
    ).toThrow();
  });
});

describe("media-storage — placeholder provider", () => {
  it("resolves a provider (interface is wired)", () => {
    const provider = getMediaStorage();
    expect(provider.name).toBe("not-configured");
  });

  it("signals that binary upload is not configured yet", async () => {
    const provider = getMediaStorage();
    await expect(
      provider.createUploadTicket({
        organizationId: "org_1",
        productId: "prod_1",
        fileName: "a.png",
        contentType: "image/png",
        size: 1024,
      }),
    ).rejects.toBeInstanceOf(MediaStorageNotConfiguredError);
  });

  it("still validates the policy before failing", async () => {
    const provider = getMediaStorage();
    await expect(
      provider.createUploadTicket({
        organizationId: "org_1",
        productId: "prod_1",
        fileName: "malware.exe",
        contentType: "application/x-msdownload",
        size: 1024,
      }),
    ).rejects.not.toBeInstanceOf(MediaStorageNotConfiguredError);
  });
});
