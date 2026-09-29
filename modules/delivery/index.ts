/**
 * Omnichannel Delivery Engine — public surface (PR010).
 *
 * modules/delivery/
 * ├── core/           delivery.interface (contracts + lifecycle) ·
 * │                   delivery.factory (Map-based, single switch point) ·
 * │                   crypto.service (AES-256-GCM, META_ENCRYPTION_KEY) ·
 * │                   meta-client (official Meta Graph HTTP core) ·
 * │                   webhook-security (X-Hub-Signature-256 + challenge)
 * ├── instagram/      auth.service · client · dm.service · webhook
 * ├── whatsapp/       auth.service · client · message.service · webhook
 * ├── queue/          dispatcher (APPROVED → QUEUED → SENDING → SENT) ·
 * │                   retry.service (3 attempts, exponential backoff)
 * ├── repositories/   delivery.repository (tenant-scoped persistence)
 * ├── dto/            client-safe projections
 * ├── validators/     zod boundary for every input
 * └── dashboard.service.ts (read-side KPI/table projections)
 *
 * OFFICIAL META APIS ONLY — no scraping, no browser automation, no
 * unofficial SDKs. All communication is server-side; credentials are
 * AES-256-GCM ciphertext at rest and NEVER reach the browser.
 *
 * This barrel only re-exports the CLIENT-SAFE surface (contracts, DTOs,
 * validators). Server entries (connectors, dispatcher, webhooks, OAuth
 * services) must be imported from their concrete paths.
 */

export * from "./core/delivery.interface";
export * from "./dto";
export * from "./validators";
