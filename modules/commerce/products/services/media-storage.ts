import "server-only";

/**
 * Media storage — INTERFACE PREPARED, provider not yet wired.
 *
 * PR001 ships the contract every future storage provider (S3, R2, Supabase
 * Storage, UploadThing…) must satisfy, plus a placeholder provider so the UI
 * flow (attach media by URL) works end-to-end today. Binary upload arrives in
 * a later PR by dropping a real implementation behind `getMediaStorage()` —
 * no caller changes required.
 */

export interface UploadRequest {
  /** Tenant scope — REQUIRED, storage keys are namespaced per organization. */
  organizationId: string;
  productId: string;
  fileName: string;
  contentType: string;
  /** Size in bytes, validated against MAX_UPLOAD_BYTES before any transfer. */
  size: number;
}

export interface UploadTicket {
  /** Where the client should PUT/POST the binary. */
  uploadUrl: string;
  /** Public URL the ProductMedia record will store after the upload. */
  publicUrl: string;
  /** Provider-specific storage key (namespaced by organizationId). */
  key: string;
  /** Extra headers/fields the client must send, when the provider needs them. */
  headers?: Record<string, string>;
}

export interface MediaStorageProvider {
  readonly name: string;
  /** Issue a pre-signed upload ticket. */
  createUploadTicket(request: UploadRequest): Promise<UploadTicket>;
  /** Remove a stored object (called when a ProductMedia row is deleted). */
  remove(key: string): Promise<void>;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

export class MediaStorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Upload binário ainda não configurado. Anexe mídias por URL — o provedor de storage será conectado em um PR futuro.",
    );
    this.name = "MediaStorageNotConfiguredError";
  }
}

/** Validate an upload request against the size/type policy (pure). */
export function assertUploadAllowed(request: Pick<UploadRequest, "contentType" | "size">): void {
  if (!ALLOWED_CONTENT_TYPES.includes(request.contentType as never)) {
    throw new Error(`Tipo de arquivo não suportado: ${request.contentType}`);
  }
  if (request.size <= 0 || request.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Arquivo excede o limite de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
  }
}

/**
 * Placeholder provider: validates the request and then reports that no
 * storage backend is configured. Swapped for a real provider in a future PR.
 */
const notConfiguredProvider: MediaStorageProvider = {
  name: "not-configured",
  async createUploadTicket(request) {
    assertUploadAllowed(request);
    throw new MediaStorageNotConfiguredError();
  },
  async remove() {
    // Nothing stored, nothing to remove.
  },
};

/** Resolve the active storage provider (env-driven in a future PR). */
export function getMediaStorage(): MediaStorageProvider {
  return notConfiguredProvider;
}
